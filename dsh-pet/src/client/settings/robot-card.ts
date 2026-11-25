/** Mount the shared robot configuration and credential form in DSH settings. */
import type { FunctionComponent } from 'react';
import type { RobotConfig } from '../../shared/robot.ts';
import { ROUTE_PATH } from '../../shared/constants.ts';
import { injectPanelCss } from '../chat/styles.ts';
import { robotConnectionError } from '../robot/locales.ts';
import { makeRobotSettings, type RobotSettingsProps } from '../robot/settings.ts';
import { useRobotState, type RobotRuntime } from '../robot/state.ts';
import type { SettingsRuntime } from './runtime.ts';

/** Save and check the robot independently of other pet preferences. */
export function makeRobotCard(rt: Omit<SettingsRuntime, 't'> & Pick<RobotRuntime, 't'>) {
  const { h, t, useEffect, useState } = rt;
  const Settings = makeRobotSettings({ ...rt, h: h as RobotRuntime['h'] }) as FunctionComponent<RobotSettingsProps>;
  return function RobotCard({ pets }: { pets: readonly { id: string; name: string }[] }) {
    const { snapshot: status, error, pending, send } = useRobotState(rt);
    const [savingToken, setSavingToken] = useState(false);
    const [feedback, setFeedback] = useState('');
    useEffect(injectPanelCss, []);
    const disabled = pending || savingToken || !!(status?.busy || status?.checking || status?.stopping);
    const saveToken = async (token: string): Promise<boolean> => {
      if (!status || savingToken) return false;
      setSavingToken(true);
      try {
        const response = await fetch(ROUTE_PATH + '/robot/credential', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session: status.session, token }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok || ((await response.json()) as { ok?: boolean }).ok !== true) throw new Error('failed');
        await send();
        setFeedback(t('robotXiaozhiTokenSaved'));
        return true;
      } catch {
        setFeedback(t('robotXiaozhiTokenFailed'));
        return false;
      } finally {
        setSavingToken(false);
      }
    };
    const statusMessage = robotConnectionError(status?.error, t);
    return h('section', {
      className: 'dsh-pet-cfg__card pet-robot',
      id: 'dsh-pet-robot-settings',
      children: [
        h('h3', { className: 'dsh-pet-cfg__title', children: t('robotSettingsTitle') }),
        status
          ? h(Settings, {
              key: status.session,
              config: status.config,
              catalog: status.catalog,
              disabled,
              pets,
              saveDeviceToken: saveToken,
              save: async (config: RobotConfig) => {
                const ok = await send({ action: 'configure', config });
                if (ok) setFeedback(t('robotSaved'));
                return ok;
              },
            })
          : null,
        h('div', {
          children: [
            h('button', {
              type: 'button',
              disabled: disabled || !status?.config.enabled,
              onClick: () => {
                setFeedback('');
                void send({ action: 'check' });
              },
              children: t('robotCheck'),
            }),
            status?.connected
              ? h('span', {
                  role: 'status',
                  children: t(status.config.xiaozhi ? 'robotXiaozhiConnected' : 'robotConnected'),
                })
              : null,
          ],
        }),
        feedback ? h('p', { role: 'status', children: feedback }) : null,
        error || statusMessage ? h('p', { role: 'alert', children: statusMessage || t('robotRequestError') }) : null,
      ],
    });
  };
}
