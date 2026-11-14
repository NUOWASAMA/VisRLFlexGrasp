// 文件功能：按当前运行环境模式返回 ECharts 配色主题，仿真绿色系 / 真实蓝色系
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-14
import { CHART_THEMES, DEFAULT_ENV_MODE, ENV_MODES } from '../config/defaults.js'

/**
 * 读取当前环境模式：优先根元素 data-env-mode，其次默认仿真。
 * 返回：'sim' 或 'real'。
 */
export function get_current_environment_mode() {
    if (typeof document !== 'undefined') {
        const mode = document.documentElement.dataset.envMode
        if (mode === ENV_MODES.SIM || mode === ENV_MODES.REAL) {
            return mode
        }
    }
    return DEFAULT_ENV_MODE
}

/**
 * 获取指定模式的图表主题。
 * 入参：mode 可选，缺省读取当前环境模式。
 * 返回：{ colors, text, axis_line, split_line, tooltip_background, tooltip_text, zoom_background, zoom_filler }。
 */
export function get_chart_theme(mode = '') {
    const resolved_mode = mode === ENV_MODES.SIM || mode === ENV_MODES.REAL
        ? mode
        : get_current_environment_mode()
    return CHART_THEMES[resolved_mode] || CHART_THEMES[DEFAULT_ENV_MODE]
}
