// 文件功能：ECharts 配置构建纯函数（六轴关节轨迹折线图、规划参考角柱状图），配色随运行环境模式切换
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11
import {
    CHART_ANIMATION_DURATION_MS,
    CHART_FONT_FAMILY,
    CHART_MIN_ZOOM_POINTS,
    CHART_SYMBOL_SIZE,
    CHART_VALUE_DECIMALS,
    CHART_ZOOM_MIN_POINT_DIVISOR,
    JOINT_COUNT,
    JOINT_NAMES,
    JOINT_SHORT_NAMES,
} from '../config/defaults.js'
import { get_chart_theme } from './chart_theme.js'
import { build_trajectory_times, format_degrees, format_number } from './format.js'

/**
 * 轴标签样式。
 * 入参：theme 图表主题。
 * 返回：ECharts textStyle 片段。
 */
function build_axis_label_style(theme) {
    return {
        color: theme.text,
        fontFamily: CHART_FONT_FAMILY,
        fontSize: 11,
    }
}

/**
 * 轴线样式。
 * 入参：theme 图表主题。
 * 返回：ECharts axisLine 片段。
 */
function build_axis_line_style(theme) {
    return {
        lineStyle: {
            color: theme.axis_line,
        },
    }
}

/**
 * 网格分割线样式。
 * 入参：theme 图表主题。
 * 返回：ECharts splitLine 片段。
 */
function build_split_line_style(theme) {
    return {
        lineStyle: {
            color: theme.split_line,
            type: 'dashed',
        },
    }
}

/**
 * 图例样式。
 * 入参：theme 图表主题。
 * 返回：ECharts legend 片段。
 */
function build_legend_style(theme) {
    return {
        top: 4,
        left: 'center',
        itemWidth: 14,
        itemHeight: 8,
        textStyle: {
            color: theme.text,
            fontFamily: CHART_FONT_FAMILY,
            fontSize: 11,
        },
    }
}

/**
 * 提示框样式。
 * 入参：theme 图表主题。
 * 返回：ECharts tooltip 片段。
 */
function build_tooltip_style(theme) {
    return {
        backgroundColor: theme.tooltip_background,
        borderWidth: 0,
        padding: [8, 12],
        textStyle: {
            color: theme.tooltip_text,
            fontFamily: CHART_FONT_FAMILY,
            fontSize: 12,
        },
    }
}

/**
 * 构建六轴关节轨迹折线图配置。
 * 入参：result 任务详情中的 result 对象（含 joint_trajectory、duration_sec、sample_period_sec）。
 * 返回：ECharts option 对象；轨迹非法（不足两点）时返回 null，由组件展示空状态。
 */
export function build_trajectory_option(result) {
    const trajectory = result && Array.isArray(result.joint_trajectory) ? result.joint_trajectory : []
    const point_count = trajectory.length
    if (point_count < 2) {
        return null
    }
    const theme = get_chart_theme()
    const times = build_trajectory_times(point_count, result.duration_sec, result.sample_period_sec)
    const series = JOINT_SHORT_NAMES.map((short_name, joint_index) => ({
        name: short_name,
        type: 'line',
        smooth: true,
        showSymbol: false,
        symbolSize: CHART_SYMBOL_SIZE,
        lineStyle: {
            width: 2,
        },
        emphasis: {
            focus: 'series',
        },
        data: trajectory.map((point) => {
            const angle = Array.isArray(point) ? Number(point[joint_index]) : NaN
            return Number.isFinite(angle) ? Number(angle.toFixed(CHART_VALUE_DECIMALS)) : null
        }),
    }))
    return {
        color: theme.colors,
        animationDuration: CHART_ANIMATION_DURATION_MS,
        textStyle: {
            fontFamily: CHART_FONT_FAMILY,
        },
        tooltip: {
            ...build_tooltip_style(theme),
            trigger: 'axis',
            axisPointer: {
                type: 'line',
            },
            formatter: (params) => {
                if (!Array.isArray(params) || params.length === 0) {
                    return ''
                }
                const lines = [`时间：${format_number(params[0].axisValue, 3)} s`]
                params.forEach((item) => {
                    const full_name = JOINT_NAMES[item.seriesIndex] || item.seriesName
                    const value_text = format_number(item.value, 3)
                    lines.push(`${item.marker}${full_name}：${value_text} rad（${format_degrees(item.value)}）`)
                })
                return lines.join('<br/>')
            },
        },
        legend: {
            ...build_legend_style(theme),
            data: JOINT_SHORT_NAMES,
        },
        grid: {
            left: 8,
            right: 20,
            top: 44,
            bottom: 52,
            containLabel: true,
        },
        xAxis: {
            type: 'category',
            data: times,
            axisLabel: {
                ...build_axis_label_style(theme),
                hideOverlap: true,
                formatter: (value) => format_number(value, 2),
            },
            axisLine: build_axis_line_style(theme),
            axisTick: {
                show: false,
            },
        },
        yAxis: {
            type: 'value',
            name: '关节角 (rad)',
            nameTextStyle: {
                color: theme.text,
                fontFamily: CHART_FONT_FAMILY,
                fontSize: 11,
            },
            scale: true,
            axisLabel: {
                ...build_axis_label_style(theme),
                formatter: (value) => format_number(value, 2),
            },
            axisLine: {
                show: false,
            },
            axisTick: {
                show: false,
            },
            splitLine: build_split_line_style(theme),
        },
        dataZoom: [
            {
                type: 'inside',
                minValueSpan: Math.max(CHART_MIN_ZOOM_POINTS, Math.round(point_count / CHART_ZOOM_MIN_POINT_DIVISOR)),
            },
            {
                type: 'slider',
                height: 14,
                bottom: 8,
                borderColor: 'transparent',
                backgroundColor: theme.zoom_background,
                fillerColor: theme.zoom_filler,
                handleSize: '80%',
                showDetail: false,
                showDataShadow: false,
            },
        ],
        series,
    }
}

/**
 * 构建规划参考角柱状图配置（机器人状态页：planning_reference 六个关节角）。
 * 入参：reference_angles 六个关节角数组（弧度），允许为 null。
 * 返回：ECharts option 对象；数据非法时返回 null。
 */
export function build_joint_bar_option(reference_angles) {
    if (!Array.isArray(reference_angles) || reference_angles.length !== JOINT_COUNT) {
        return null
    }
    const numeric_angles = reference_angles.map((angle) => Number(angle))
    if (numeric_angles.some((angle) => !Number.isFinite(angle))) {
        return null
    }
    const theme = get_chart_theme()
    return {
        animationDuration: CHART_ANIMATION_DURATION_MS,
        textStyle: {
            fontFamily: CHART_FONT_FAMILY,
        },
        tooltip: {
            ...build_tooltip_style(theme),
            trigger: 'axis',
            axisPointer: {
                type: 'shadow',
            },
            formatter: (params) => {
                if (!Array.isArray(params) || params.length === 0) {
                    return ''
                }
                const item = params[0]
                const joint_name = JOINT_NAMES[item.dataIndex] || item.seriesName
                return `${joint_name}：${format_number(item.value, 3)} rad（${format_degrees(item.value)}）`
            },
        },
        grid: {
            left: 8,
            right: 16,
            top: 24,
            bottom: 8,
            containLabel: true,
        },
        xAxis: {
            type: 'category',
            data: JOINT_SHORT_NAMES,
            axisLabel: build_axis_label_style(theme),
            axisLine: build_axis_line_style(theme),
            axisTick: {
                show: false,
            },
        },
        yAxis: {
            type: 'value',
            name: '关节角 (rad)',
            nameTextStyle: {
                color: theme.text,
                fontFamily: CHART_FONT_FAMILY,
                fontSize: 11,
            },
            axisLabel: {
                ...build_axis_label_style(theme),
                formatter: (value) => format_number(value, 2),
            },
            axisLine: {
                show: false,
            },
            axisTick: {
                show: false,
            },
            splitLine: build_split_line_style(theme),
        },
        series: [
            {
                name: '规划参考角',
                type: 'bar',
                barWidth: '46%',
                data: numeric_angles.map((angle, joint_index) => ({
                    value: angle,
                    itemStyle: {
                        color: theme.colors[joint_index % theme.colors.length],
                        borderRadius: [4, 4, 0, 0],
                    },
                })),
                label: {
                    show: true,
                    position: 'top',
                    color: theme.text,
                    fontFamily: CHART_FONT_FAMILY,
                    fontSize: 10,
                    formatter: (params) => format_degrees(params.value),
                },
                markLine: {
                    silent: true,
                    symbol: 'none',
                    label: {
                        show: false,
                    },
                    lineStyle: {
                        color: theme.axis_line,
                        type: 'dashed',
                    },
                    data: [
                        {
                            yAxis: 0,
                        },
                    ],
                },
            },
        ],
    }
}
