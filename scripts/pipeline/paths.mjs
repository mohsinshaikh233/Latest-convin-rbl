import path from 'node:path';
import { env } from './config.mjs';

export function pipelineRoot() {
  return env('PIPELINE_ROOT', path.join(process.cwd(), '.pipeline-data'));
}

export const rawDir = (month) => path.join(pipelineRoot(), 'raw', month);
export const cohortsDir = (month) => path.join(pipelineRoot(), 'raw', month, 'calllogs');
export const assembledDir = (month) => path.join(pipelineRoot(), 'assembled', month);
export const reportsDir = (month) => path.join(pipelineRoot(), 'reports', month);
