export function parseAdbDevices(output) {
  return String(output).split(/\r?\n/).slice(1).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [serial, state, ...details] = line.split(/\s+/);
    const properties = Object.fromEntries(details.filter((part) => part.includes(':')).map((part) => {
      const index = part.indexOf(':');
      return [part.slice(0, index), part.slice(index + 1)];
    }));
    return { serial, state, model: properties.model ?? '', product: properties.product ?? '', device: properties.device ?? '' };
  });
}

export function selectA56(devices) {
  const authorized = devices.filter((device) => device.state === 'device');
  const matches = authorized.filter((device) => /(?:SM-A566|A56)/i.test(`${device.model} ${device.product} ${device.device}`));
  if (matches.length === 0) throw new Error('연결되고 승인된 A56을 찾지 못했습니다. 다른 기기는 조작하지 않습니다.');
  if (matches.length > 1) throw new Error(`A56이 ${matches.length}대라 한 대를 안전하게 고를 수 없습니다.`);
  return matches[0];
}
