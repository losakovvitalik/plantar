// The Docker server fixture is shared with the @plantar/core integration
// tests: one Dockerfile, one container lifecycle, one password. This
// re-export exists so the e2e vitest config and test reference it from
// inside apps/desktop.
export {
  default,
  SSH_PASSWORD,
  SSH_USER,
} from "../../../packages/core/test/integration/global-setup";
