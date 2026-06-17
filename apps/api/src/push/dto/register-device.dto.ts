/**
 * Body for POST /push/devices. A device sends whichever tokens it has:
 * apnsToken for alert pushes, voipToken for Twilio VoIP/incoming-call pushes.
 * At least one is required (validated in the service).
 */
export class RegisterDeviceDto {
  platform?: string; // ios | android (android reserved for later)
  apnsToken?: string;
  voipToken?: string;
  appVersion?: string;
  deviceName?: string;
}
