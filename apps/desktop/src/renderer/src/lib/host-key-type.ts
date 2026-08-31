/**
 * The name of a host key type as the user will meet it outside Plantar. Keys
 * carry the SSH wire name of their algorithm ("ssh-ed25519", "ssh-rsa",
 * "ecdsa-sha2-nistp256"), while hosting control panels and `ssh-keygen -lf`
 * print "ED25519", "RSA", "ECDSA" — and it is one of those lines the user is
 * asked to find, so the wire name shown as it is would send them looking for a
 * string that is not there.
 *
 * Only names a handshake can actually settle on are translated: the curve is
 * left out of the ECDSA name because panels print none, and "ssh-rsa" covers
 * the rsa-sha2-512 and rsa-sha2-256 algorithms as well — an RSA key names
 * itself "ssh-rsa" whichever of the three the handshake chose. An unknown name
 * is shown unchanged: a name that cannot be found beats no name at all.
 *
 * The CLI deliberately does the opposite and prints the wire name, because
 * there the value is meant to be copied into PLANTAR_HOST_KEY_TYPE verbatim.
 * Here it is a label to recognise, not a value to copy.
 *
 * The names live here and not in ru.ts/en.ts on purpose: they are protocol
 * identifiers to be matched against a control panel letter for letter, not text
 * to translate — a translated one would match nothing the user can see.
 */
export function hostKeyTypeLabel(type: string): string {
  if (type === "ssh-ed25519") return "ED25519";
  if (type === "ssh-rsa") return "RSA";
  if (type.startsWith("ecdsa-sha2-")) return "ECDSA";
  return type;
}
