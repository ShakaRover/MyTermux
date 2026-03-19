/**
 * Relay 健康检查工具
 *
 * 负责将监听地址转换为可探测地址，并执行健康检查请求。
 */

/** 将主机名格式化为 URL 可用形式（IPv6 需加方括号） */
export function formatHostForUrl(host: string): string {
  const normalized = host.trim();
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    return normalized;
  }
  return normalized.includes(':') ? `[${normalized}]` : normalized;
}

/** 解析健康检查探测地址列表 */
export function resolveHealthProbeHosts(host: string): string[] {
  const normalized = host.trim();
  const hosts: string[] = [];

  const pushUnique = (value: string): void => {
    if (value && !hosts.includes(value)) {
      hosts.push(value);
    }
  };

  if (!normalized) {
    pushUnique('127.0.0.1');
    return hosts;
  }

  // 通配监听地址不可直接作为客户端探测目标，需回退到本地可访问地址
  if (normalized === '0.0.0.0' || normalized === '*') {
    pushUnique('127.0.0.1');
    pushUnique('localhost');
    return hosts;
  }

  if (normalized === '::' || normalized === '[::]' || normalized === '::0') {
    pushUnique('::1');
    pushUnique('127.0.0.1');
    pushUnique('localhost');
    return hosts;
  }

  pushUnique(normalized);
  return hosts;
}

/**
 * 通过健康检查获取服务器状态
 *
 * 会按探测地址依次尝试，任一成功即返回。
 */
export async function fetchHealthStatus(host: string, port: number): Promise<Record<string, unknown> | null> {
  const probeHosts = resolveHealthProbeHosts(host);

  for (const probeHost of probeHosts) {
    const healthUrl = `http://${formatHostForUrl(probeHost)}:${port}/health`;
    try {
      const response = await fetch(healthUrl);
      if (response.ok) {
        return await response.json() as Record<string, unknown>;
      }
    } catch {
      // 继续尝试下一个地址
    }
  }

  return null;
}

