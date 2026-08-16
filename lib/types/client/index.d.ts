/**
 * @dsh-external/dsh-update-center 设置页面板（settings.section）。
 * 功能：dsh 版本/更新状态 + 已安装插件清单（npm/link 分类）+ 一键更新按钮。
 * 通信：同源 fetch → host webServer API（/update-center/api）。
 */
import type { SlotsService } from '@deepseek-ai/dsh-client-ui-slots';
type ClientContext = {
    slots: SlotsService;
};
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
export {};
