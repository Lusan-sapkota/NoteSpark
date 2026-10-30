// The "Network rule": only private peer addresses (IPv4, IPv6, IPv4-mapped) and `.local` / `.ts.net` names are allowed, never the internet.
export const isPrivateAddress = (address: string): boolean => {
  const ip = address.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    if ([a, b, c, d].some(n => n > 255)) return false;
    return (
      a === 10 || // 10/8
      a === 127 || // loopback
      (a === 172 && b >= 16 && b <= 31) || // 172.16/12
      (a === 192 && b === 168) || // 192.168/16
      (a === 169 && b === 254) || // link-local
      (a === 100 && b >= 64 && b <= 127) // 100.64/10, Tailscale CGNAT
    );
  }
  if (!ip.includes(':')) return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:local|ts\.net)$/.test(ip); // mDNS and Tailscale MagicDNS names
  return ip === '::1' || /^f[cd][0-9a-f]{2}:/.test(ip) || /^fe[89ab][0-9a-f]:/.test(ip); // loopback, ULA, link-local
};
