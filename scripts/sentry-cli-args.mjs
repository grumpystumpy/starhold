export function sentryInjectArgs(outdir) {
  return ["sentry-cli", "sourcemaps", "inject", outdir];
}

export function sentryUploadArgs({ org, project, outdir }) {
  return ["sentry-cli", "sourcemaps", "upload", "--org", org, "--project", project, outdir];
}
