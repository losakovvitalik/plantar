import { describe, expect, it } from "vitest";
import { hostKeyTypeLabel } from "./host-key-type";

describe("hostKeyTypeLabel", () => {
  it("names the types a handshake can settle on the way a panel prints them", () => {
    expect(hostKeyTypeLabel("ssh-ed25519")).toBe("ED25519");
    expect(hostKeyTypeLabel("ssh-rsa")).toBe("RSA");
  });

  it("drops the curve from an ECDSA name, which panels do not print", () => {
    expect(hostKeyTypeLabel("ecdsa-sha2-nistp256")).toBe("ECDSA");
    expect(hostKeyTypeLabel("ecdsa-sha2-nistp384")).toBe("ECDSA");
    expect(hostKeyTypeLabel("ecdsa-sha2-nistp521")).toBe("ECDSA");
  });

  it("shows an unknown name unchanged", () => {
    expect(hostKeyTypeLabel("ssh-dss")).toBe("ssh-dss");
  });
});
