// Meeting codes are the room ID at the end of a meeting link.
const CODE = /^[\w-]{1,64}$/;

export const isMeetingCode = (value) => CODE.test(value);

// Accepts a full meeting link from this site, or just its code.
export function parseMeetingCode(input, origin) {
  const value = String(input).trim();
  if (!value) return null;
  let code = value;
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.origin !== origin) return null;
      code = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] ?? "");
    } catch {
      return null;
    }
  }
  return isMeetingCode(code) ? code : null;
}
