/** Standalone settings use the same authenticated host contract and copy as the DSH panel. */
import { observabilityZh } from '../../../client/settings/locales/observability.ts';
import { DEFAULT_OBSERVABILITY } from '../../../shared/observability.ts';

export function observabilityScript(): string {
  return `
function wireObservability() {
  const copy = ${JSON.stringify(observabilityZh)};
  const defaults = ${JSON.stringify(DEFAULT_OBSERVABILITY)};
  const root = byId('observation-panel');
  const fields = {};
  const status = make('p', { role: 'status', class: 'status' });
  const recent = make('ul');
  const links = make('div');
  let initialized = false;
  let busy = false;
  let saved;
  root.append(make('p', { class: 'cardHint', text: copy.observationHint }));
  for (const [name, title, type] of [
    ['enabled', 'observationEnabled', 'checkbox'], ['baseUrl', 'observationBaseUrl', 'text'],
    ['agentId', 'observationAgentId', 'text'], ['spaceId', 'observationSpaceId', 'text'],
    ['spaceKey', 'observationKey', 'password'], ['clearKey', 'observationClearKey', 'checkbox'],
    ['captureContent', 'observationContent', 'checkbox'], ['includeBackground', 'observationBackground', 'checkbox'],
    ['allowInsecureHttp', 'observationHttp', 'checkbox'],
  ]) {
    const input = make('input', { id: 'observation-' + name, type, autocomplete: type === 'password' ? 'new-password' : 'off', disabled: true });
    fields[name] = input;
    root.append(make('div', { class: 'field' }, [make('label', { for: input.id, text: copy[title] }), input]));
  }
  const save = make('button', { type: 'button', class: 'btn primary', text: copy.observationSave, disabled: true });
  const check = make('button', { type: 'button', class: 'btn', text: copy.observationCheck, disabled: true });
  function render(value) {
    if (!value.config || !Array.isArray(value.interactions)) throw new Error('invalid status');
    saved = value;
    if (!initialized) {
      for (const name of Object.keys(defaults)) {
        fields[name][typeof defaults[name] === 'boolean' ? 'checked' : 'value'] = value.config[name];
      }
      initialized = true;
      for (const input of Object.values(fields)) input.disabled = false;
      save.disabled = false;
    }
    check.disabled = busy || !value.config.enabled;
    fields.spaceKey.placeholder = copy[value.hasKey ? 'observationKeySaved' : 'observationKeyEmpty'];
    links.replaceChildren();
    if (value.memoryUrl) links.append(make('a', { href: value.memoryUrl, target: '_blank', rel: 'noopener noreferrer', text: copy.observationMemory }));
    recent.replaceChildren();
    const outcomes = { running: 'observationRunning', success: 'observationSuccess', error: 'observationError', cancelled: 'observationCancelled' };
    const deliveries = { pending: 'observationPending', accepted: 'observationDelivered', failed: 'observationExportFailed' };
    for (const item of value.interactions.slice(0, 10)) recent.append(make('li', {}, [
      item.operation + ' · ' + copy[outcomes[item.outcome]] + ' · ' + (item.durationMs === undefined ? '—' : item.durationMs + ' ms') + ' · ' + copy[deliveries[item.delivery]] + ' ',
      make('a', { href: item.url, target: '_blank', rel: 'noopener noreferrer', text: copy.observationView }),
    ]));
    if (!value.interactions.length) recent.append(make('li', { text: copy.observationEmpty }));
  }
  async function submit(test) {
    if (busy) return;
    busy = true; save.disabled = true; check.disabled = true;
    try {
      let result;
      if (test) {
        result = await callApi('POST', '/observability/check', {});
        render(result.status);
        setStatus(status, copy[result.accepted ? 'observationAccepted' : 'observationFailed'], result.accepted ? 'ok' : 'error');
      } else {
        const update = {};
        for (const name of Object.keys(defaults)) update[name] = fields[name][typeof defaults[name] === 'boolean' ? 'checked' : 'value'];
        if (fields.spaceKey.value) update.spaceKey = fields.spaceKey.value;
        update.clearKey = fields.clearKey.checked;
        result = await callApi('PUT', '/observability', update);
        render(result); fields.spaceKey.value = ''; fields.clearKey.checked = false;
        setStatus(status, copy.observationSaved, 'ok');
      }
    } catch { setStatus(status, copy.observationFailed, 'error'); }
    finally { busy = false; save.disabled = !initialized; check.disabled = !saved?.config.enabled; }
  }
  save.addEventListener('click', () => { void submit(false); });
  check.addEventListener('click', () => { void submit(true); });
  root.append(make('div', { class: 'actions' }, [save, check]), status, links,
    make('h3', { text: copy.observationRecent }), recent, make('p', { class: 'cardHint', text: copy.observationEvidence }));
  async function poll() {
    try { render(await callApi('GET', '/observability')); }
    catch { if (!initialized) setStatus(status, copy.observationLoadFailed, 'error'); }
    setTimeout(poll, 3000);
  }
  void poll();
}
`;
}
