/** Attach the Astra controller to the plugin lifecycle and existing pet feedback routes. */
import { createRobotService, type RobotService } from '../robot/service.ts';
import { ROUTE_SEGMENT } from '../../shared/constants.ts';
import type { HostContext } from './context.ts';
import type { HttpRouteHandler } from './http-route.ts';
import type { PetObservability } from '../observability/service.ts';
import type { PollStateStore } from '../state.ts';

/** Keep robot feedback on the normal pet validation and lock-aware path. */
export function registerRobot(
  ctx: HostContext,
  userRoot: string,
  state: PollStateStore,
  route: () => HttpRouteHandler,
  observability?: PetObservability,
): RobotService {
  const service = createRobotService({
    userRoot,
    state,
    observability,
    async feedback(event) {
      const query = '?pet=' + encodeURIComponent(event.petId) + '&surface=any';
      await route()(ROUTE_SEGMENT + '/broadcast' + query, 'POST', JSON.stringify({ text: event.text, anim: false }));
      if (event.animation)
        await route()(ROUTE_SEGMENT + '/anim' + query, 'POST', JSON.stringify({ name: event.animation }));
    },
  });
  ctx.effect(() => () => service.dispose(), 'dsh-pet: Astra robot controller');
  return service;
}
