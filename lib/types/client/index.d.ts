import type { ReactNode } from 'react';
import type { SlotsService } from '@deepseek-ai/dsh-client-ui-slots';
type ClientContext = {
    effect: (callback: () => void | (() => void), label?: string) => void;
    slots: SlotsService;
};
export declare const inject: string[];
export declare function UpdateCenterPanel(): ReactNode;
export declare function apply(ctx: ClientContext): void;
export {};
