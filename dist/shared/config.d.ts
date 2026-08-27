import { type PipelineConfig } from './types.js';
export declare class ConfigError extends Error {
    constructor(message: string);
}
export declare function loadConfig(path: string): PipelineConfig;
export declare function parseConfig(raw: string, sourceLabel?: string): PipelineConfig;
