import { defineRailway, github, project, service } from "railway/iac";

// Railway's settings for the API service, replacing the root railway.json.
// Railway stops reading railway.json on 2026-12-01. Railway does not read this
// file during a deploy either; it changes the service only through
// `railway config apply`, so a push to master never applies it.
//
// The partial is what keeps Postgres and Redis safe. A file with no partial
// export owns the whole project, and a resource it leaves out is DELETED on
// apply. With a partial, this file only owns what it declares here. Never
// replace this file with `railway config pull` or `railway config init`: both
// import the whole project.
//
// `railway config migrate` wrote the partial as "@fast-homes/api", which
// `railway config plan` rejects (only letters, digits, ".", "_" and "-"). The
// service keeps its name; only the partial changed.
//
// railway.json's restart policy (ON_FAILURE, 10 retries) has no field here, so
// it stays whatever the service settings in the dashboard say.
//
// Variables are not managed here (`managed: false`): the ones on Railway stay
// where they are and never land in this repository.
//
// Preview with: cd .railway && npm ci --ignore-scripts, then from the repo root
// `railway config plan --file .railway/railway.ts`.
export const partial = "fast-homes-api";

export default defineRailway(() => {
  const _fastHomesapi = service("@fast-homes/api", {
    source: github("gaslaksen/fast-homes-crm", { branch: "master", checkSuites: false, rootDirectory: "/" }),
    build: { buildCommand: "", buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "apps/api/Dockerfile" },
    start: "sh -c 'cd /app/apps/api && npx prisma migrate deploy && node /app/apps/api/dist/main'",
    preDeploy: [],
    replicas: { "europe-west4-drams3a": 1, "us-east4-eqdc4a": 1 },
    domains: [{ domain: "api.mydealcore.com", port: 3001 }],
    networking: { privateNetworkEndpoint: "fast-homesapi" },
  });

  return project("dealcore", {
    variables: { managed: false },
    resources: [_fastHomesapi],
  });
});
