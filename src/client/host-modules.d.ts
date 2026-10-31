/**
 * 宿主基线模块的类型声明。
 *
 * `@deepseek-ai/dsh-client-ui-primitives` 是桌面端 shell 在运行时提供的共享模块
 * （见 `@deepseek-ai/dsh-client-modules` 的 PLATFORM_MODULES 静态表），不落盘、
 * 没有随包发布的 .d.ts。这里只声明本插件实际用到的导出，签名以宿主 bundle 里
 * 的真实实现和 dsh-archive-vault 的既有用法为准。
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  /** 插槽服务：inject 声明依赖，register 往宿主插槽里挂组件。 */
  export type SlotsService = {
    inject: (slot: string, callback: () => void | (() => void)) => () => void
    register: (
      options: { name: string; id: string; order?: number; label?: () => string },
      component: () => unknown,
    ) => () => void
  }
}

declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ReactNode } from 'react'

  /** 按钮：variant 决定视觉层级（默认 ghost），icon 渲染在文字左侧。 */
  export const Button: (props: {
    variant?: 'primary' | 'ghost' | 'outline' | 'toolbar' | 'icon'
    size?: 'sm' | 'md'
    icon?: ReactNode
    disabled?: boolean
    title?: string
    onClick?: () => void
    children?: ReactNode
  }) => ReactNode

  /** 不可逆操作的模态确认：勾选 acknowledge 后才允许确认。 */
  export const RiskConfirmation: (props: {
    open: boolean
    title: string
    description: string
    acknowledgeLabel: string
    cancelLabel: string
    closeLabel: string
    confirmLabel: string
    acknowledged: boolean
    disabled?: boolean
    onAcknowledgedChange: (next: boolean) => void
    onCancel: () => void
    onConfirm: () => void
  }) => ReactNode

  /** 结果提示条：挂载后自动消失，onDone 回调用于清理状态。 */
  export const Toast: (props: {
    text: string
    tone?: 'success' | 'error'
    onDone?: () => void
  }) => ReactNode

  /** 分段切换（市场的视图切换）。items 用 { value, label }。 */
  export const SegmentedTabs: (props: {
    items: Array<{ value: string; label: string }>
    value: string
    label?: string
    onChange: (value: string) => void
  }) => ReactNode

  /** 小标签：无 onClick 时渲染 span，有则渲染可点按钮。 */
  export const Pill: (props: {
    active?: boolean
    className?: string
    onClick?: () => void
    children?: ReactNode
  }) => ReactNode

  export const Input: (props: {
    value: string
    placeholder?: string
    type?: string
    onChange?: (event: { target: { value: string } }) => void
    disabled?: boolean
  }) => ReactNode

  export const Checkbox: (props: {
    checked: boolean
    label?: ReactNode
    disabled?: boolean
    onChange: (next: boolean) => void
  }) => ReactNode

  /** 图标：size 是像素，描边宽度走 ICON_*_STROKE 常量。 */
  type IconProps = { size?: number }
  export const IconRefreshOutlineRegular: (props: IconProps) => ReactNode
  export const IconTrashOutlineRegular: (props: IconProps) => ReactNode
  export const IconDownloadOutlineRegular: (props: IconProps) => ReactNode
  export const IconEditOutlineRegular: (props: IconProps) => ReactNode
  export const IconSearchOutlineRegular: (props: IconProps) => ReactNode
  export const IconEllipsisOutlineRegular: (props: IconProps) => ReactNode
  export const IconWarningOutlineRegular: (props: IconProps) => ReactNode
  export const IconCheckOutlineRegular: (props: IconProps) => ReactNode
  export const IconCheckCircleOutlineRegular: (props: IconProps) => ReactNode
  export const IconPlayOutlineRegular: (props: IconProps) => ReactNode
  export const IconLinkOutlineRegular: (props: IconProps) => ReactNode
  export const IconFolderOpenOutlineRegular: (props: IconProps) => ReactNode
  export const IconCordisPluginOutlineRegular: (props: IconProps) => ReactNode
}