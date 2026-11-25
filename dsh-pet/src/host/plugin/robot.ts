/** Attach the robot controller to the plugin lifecycle and existing pet feedback routes. */
import { createRobotService, type RobotService } from '../robot/service.ts';
import { ROUTE_SEGMENT } from '../../shared/constants.ts';
import type { HostContext } from './context.ts';
import type { HttpRouteHandler } from './http-route.ts';
import type { PetObservability } from '../observability/service.ts';
import type { PollStateStore } from '../state.ts';
import { xiaozhiTokenRef } from '../robot/xiaozhi-connection.ts';

/** Keep robot feedback on the normal pet validation and lock-aware path. */
export function registerRobot(
  ctx: HostContext,
  userRoot: string,
  state: PollStateStore,
  route: () => HttpRouteHandler,
  observability?: PetObservability,
): RobotService {
  const credentials = ctx.credentials;
  const service = createRobotService({
    userRoot,
    state,
    observability,
    ...(typeof credentials?.set === 'function' && {
      xiaozhiTokens: {
        read: async (apiUrl: URL) => (await credentials.resolve(xiaozhiTokenRef(apiUrl)))?.value,
        write: (apiUrl: URL, token: string) => credentials.set(xiaozhiTokenRef(apiUrl), token),
      },
    }),
    async feedback(event) {
      const query = '?pet=' + encodeURIComponent(event.petId) + '&surface=any';
      // Command receipts belong in the robot panel, never in pet speech or the TTS forwarding loop.
      if (event.animation)
        await route()(ROUTE_SEGMENT + '/anim' + query, 'POST', JSON.stringify({ name: event.animation }));
    },
  });
  ctx.effect(() => () => service.dispose(), 'dsh-pet: robot controller');
  return service;
}
