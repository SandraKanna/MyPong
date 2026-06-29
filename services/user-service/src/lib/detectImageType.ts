// STUDY: Magic-byte detection is the correct approach for file type validation because
// a client can set any Content-Type header and choose any filename — both are untrusted
// inputs under the client's full control. Magic bytes are the first N bytes of the actual
// file content, defined by each format's spec. Spoofing them requires constructing a
// file whose content genuinely starts with the target signature, which for formats like
// JPEG/PNG means the data must also be valid enough for the decoder (sharp) to accept.
// Extension or MIME-type checks can be trivially bypassed with "malicious.jpg" or a
// fabricated header — they add zero security for file validation.
export function detectImageType(buf: Buffer): 'jpeg' | 'png' | 'webp' | 'gif' | null {
  if (buf.length < 12) return null;

  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'jpeg';

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'png';

  // GIF: 47 49 46 38 (GIF87a or GIF89a)
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif';

  // WebP: bytes 0-3 = "RIFF", bytes 8-11 = "WEBP"
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return 'webp';

  return null;
}
