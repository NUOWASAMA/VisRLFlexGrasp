// 文件功能：ECharts 按需注册入口，仅打包折线图与柱状图所需模块，减小构建体积
// 作者：VisRLFlexGrasp 项目组
// 创建日期：2026-11-11
import { BarChart, LineChart } from 'echarts/charts'
import {
    DataZoomComponent,
    GridComponent,
    LegendComponent,
    MarkLineComponent,
    TooltipComponent,
} from 'echarts/components'
import { init, use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'

use([
    LineChart,
    BarChart,
    GridComponent,
    TooltipComponent,
    LegendComponent,
    DataZoomComponent,
    MarkLineComponent,
    CanvasRenderer,
])

export { init }
