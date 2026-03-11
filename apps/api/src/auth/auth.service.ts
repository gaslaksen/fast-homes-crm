import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  private get jwtSecret() {
    return this.config.get('JWT_SECRET') || 'dev-secret-key';
  }

  private signToken(user: { id: string; email: string; role: string; organizationId?: string | null }) {
    return jwt.sign(
      { userId: user.id, email: user.email, role: user.role, organizationId: user.organizationId },
      this.jwtSecret,
      { expiresIn: '30d' },
    );
  }

  private userShape(user: any) {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      organizationId: user.organizationId,
      organization: user.organization
        ? { id: user.organization.id, name: user.organization.name, plan: user.organization.plan }
        : null,
    };
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { organization: true },
    });

    if (!user) throw new Error('Invalid credentials');

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw new Error('Invalid credentials');

    return { token: this.signToken(user), user: this.userShape(user) };
  }

  async register(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    organizationId?: string;
  }) {
    const existing = await this.prisma.user.findUnique({
      where: { email: data.email.toLowerCase().trim() },
    });
    if (existing) throw new Error('Email already registered');

    // Verify org exists if provided
    if (data.organizationId) {
      const org = await this.prisma.organization.findUnique({ where: { id: data.organizationId } });
      if (!org) throw new Error('Organization not found');
      const memberCount = await this.prisma.user.count({ where: { organizationId: data.organizationId } });
      if (memberCount >= org.maxUsers) throw new Error(`Organization has reached its user limit (${org.maxUsers})`);
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: data.email.toLowerCase().trim(),
        password: hashedPassword,
        firstName: data.firstName,
        lastName: data.lastName,
        role: 'AGENT',
        organizationId: data.organizationId || null,
      },
      include: { organization: true },
    });

    return { token: this.signToken(user), user: this.userShape(user) };
  }

  async verifyToken(token: string) {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as any;
      const user = await this.prisma.user.findUnique({
        where: { id: decoded.userId },
        include: { organization: true },
      });
      if (!user) throw new Error('User not found');
      return this.userShape(user);
    } catch {
      throw new Error('Invalid token');
    }
  }

  // ── Admin: invite a new team member to an org ────────────────────────────
  async inviteUser(data: {
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    organizationId: string;
    tempPassword: string;
  }) {
    const org = await this.prisma.organization.findUnique({ where: { id: data.organizationId } });
    if (!org) throw new Error('Organization not found');

    const memberCount = await this.prisma.user.count({ where: { organizationId: data.organizationId } });
    if (memberCount >= org.maxUsers) throw new Error(`Plan limit reached (${org.maxUsers} users). Upgrade to add more.`);

    const existing = await this.prisma.user.findUnique({ where: { email: data.email.toLowerCase().trim() } });
    if (existing) throw new Error('Email already registered');

    const hashedPassword = await bcrypt.hash(data.tempPassword, 10);
    const user = await this.prisma.user.create({
      data: {
        email: data.email.toLowerCase().trim(),
        password: hashedPassword,
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role || 'AGENT',
        organizationId: data.organizationId,
      },
      include: { organization: true },
    });

    return { user: this.userShape(user) };
  }

  // ── List users in the same org ───────────────────────────────────────────
  async getOrgUsers(organizationId: string) {
    return this.prisma.user.findMany({
      where: { organizationId },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ── Change own password ──────────────────────────────────────────────────
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found');
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) throw new Error('Current password is incorrect');
    const hashed = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { password: hashed } });
    return { success: true };
  }

  // ── Admin: reset a user's password ──────────────────────────────────────
  async resetPassword(userId: string, newPassword: string) {
    const hashed = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { password: hashed } });
    return { success: true };
  }

  // ── Update organization name (business branding) ─────────────────────────
  async updateOrganization(organizationId: string, name: string) {
    const org = await this.prisma.organization.update({
      where: { id: organizationId },
      data: { name },
    });
    return { id: org.id, name: org.name, plan: org.plan };
  }
}
