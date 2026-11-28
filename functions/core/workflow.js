// ==========================================================
// Core: service workflows
// A service's workflow is the list of steps every order of it runs
// (Services/{slug}.workflow), set in the Admin Panel → Services. A
// service without one falls back to its plugin's steps (Plugins/{id}.steps)
// for chat orders, as before; checkout and admin orders run only a
// workflow set on the service itself.
// One step: { stepNo, owner, capability, clientLabel, lawyerTask, config }
//   owner       chat (AI Law does it) | lawyer (waits in the task desk)
//   capability  what a chat step does: collect, await_payment, calculate,
//               deliver, or a plugin's own (core/steps.js)
//   config      needsFile, needsApproval, dueDays, email (deliver), and
//               anything a capability reads (e.g. calculate's base, rate, output)
// ==========================================================

import { ApiError, cleanText } from './app.js';
import { pluginRecords } from './loader.js';

export const OWNERS = ['chat', 'lawyer'];
// The step types the workflow editor offers; plugins may run others
export const CAPABILITIES = ['collect', 'await_payment', 'calculate', 'deliver', 'task'];
const MAX_STEPS = 30;

// A workflow from the Admin Panel → a checked list, numbered 1, 2, 3 …
export function cleanWorkflow(input) {
  if (!Array.isArray(input)) throw new ApiError('INVALID_WORKFLOW');
  if (input.length > MAX_STEPS) throw new ApiError('TOO_MANY_STEPS');
  return input.map((raw, i) => {
    const owner = OWNERS.includes(raw?.owner) ? raw.owner : 'chat';
    const capability = owner === 'lawyer' ? 'task' : cleanText(raw?.capability || '', 40, 'INVALID_WORKFLOW');
    // "task" is the lawyer's own kind of step; AI Law's steps need one it can run
    if (owner === 'chat' && (!/^[a-z_]{2,40}$/.test(capability) || capability === 'task')) {
      throw new ApiError('INVALID_WORKFLOW');
    }
    const clientLabel = cleanText(raw?.clientLabel, 120, 'INVALID_WORKFLOW');
    if (!clientLabel) throw new ApiError('STEP_LABEL_REQUIRED');
    const given = raw?.config && typeof raw.config === 'object' && !Array.isArray(raw.config) ? raw.config : {};
    const config = { ...given };
    config.needsFile = given.needsFile === true;
    config.needsApproval = owner === 'lawyer' && given.needsApproval === true;
    const days = Math.round(Number(given.dueDays) || 0);
    config.dueDays = days > 0 && days <= 365 ? days : 0;
    if (capability === 'deliver') config.email = given.email !== false;
    if (JSON.stringify(config).length > 2000) throw new ApiError('INVALID_WORKFLOW');
    return {
      stepNo: i + 1,
      stepId: cleanText(raw?.stepId || '', 60, 'INVALID_WORKFLOW'),
      owner,
      capability,
      clientLabel,
      lawyerTask: cleanText(raw?.lawyerTask || '', 2000, 'INVALID_WORKFLOW'),
      config,
    };
  });
}

// The steps a new order of this service runs. fromChat: a chat order may
// fall back to the service plugin's own steps.
export async function workflowOf(service, fromChat = false) {
  if (Array.isArray(service?.workflow) && service.workflow.length) return service.workflow;
  if (!fromChat || !service?.plugin) return [];
  return (await pluginRecords())[service.plugin]?.steps || [];
}
