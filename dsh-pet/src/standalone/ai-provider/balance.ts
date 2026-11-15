/**
 * Balance query in standalone mode: Inject the key filled in the settings page into the service provider definition
 * of host side.
 *
 * There is no DSH account service in standalone mode, nor is there credential store. The key is only the one saved on
 * the settings page; therefore, there is only one thing to do here - wrap key into the parsing callback required by
 * queryBalance, and use the host side for fetching and parsing.
 * @module dsh-pet/src/standalone/ai-provider/balance
 */
import { queryBalance as queryProviderBalance, type BalanceResult } from '../../host/balance/index.ts';

/**
 * 按设置里选中的服务商查询余额。
 * @param provider - 当前服务商；自定义（custom）不在余额名录里，由 host 半侧落成 unsupported。
 * @param apiKey - 设置页保存的密钥；为空时由 host 半侧落成 credential-missing。
 * @returns host 半侧的归一化结果；失败绝不带伪造数字。
 */
export async function queryStandaloneBalance(provider: string, apiKey: string): Promise<BalanceResult> {
  if (!provider) return { ok: false, provider: '', reason: 'unsupported' };
  return queryProviderBalance(provider, async () => (apiKey ? apiKey : undefined));
}
