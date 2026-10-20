/** 插件可配置项 */
import Schema from '@deepseek-ai/schemastery'

export interface Config {
  /** 默认项目根目录 */
  projectRoot: string
  /** 生成 .ts 而非 .js */
  useTypeScript: boolean
  /** 组件目录（可多个，逗号分隔），扫描页面时跳过 */
  componentDirs: string
  /** 新建工程时使用的 AppID */
  appId: string
  /** 微信开发者工具 CLI 路径，留空自动探测 */
  devtoolsCli: string
  /** IDE 服务端口；留空由 CLI 自行决定 */
  devtoolsPort: string
  /** CLI 超时（秒） */
  devtoolsTimeoutSec: number
  /** 预览二维码落盘目录，留空用系统临时目录 */
  previewDir: string
}

export const Config: Schema<Config> = Schema.object({
  projectRoot: Schema.string()
    .default('')
    .description('默认小程序项目根目录；可以是项目根（含 project.config.json），也可以直接是含 app.json 的代码根。留空则每次由模型传入'),
  useTypeScript: Schema.boolean().default(false).description('新建页面/组件时生成 .ts 而非 .js'),
  componentDirs: Schema.string()
    .default('components')
    .description('组件目录（相对代码根，多个用逗号分隔）；扫描页面与「孤儿页」检查时跳过这些目录，避免把组件当成页面'),
  appId: Schema.string().default('').description('mp_project_init 新建工程时写入 project.config.json 的 AppID；留空则用测试号占位'),
  devtoolsCli: Schema.string()
    .default('')
    .description('微信开发者工具 CLI 的绝对路径；留空则自动在常见安装位置查找（macOS: /Applications/wechatwebdevtools.app/Contents/MacOS/cli）'),
  devtoolsPort: Schema.string().default('').description('开发者工具 HTTP 服务端口；留空由 CLI 决定。IDE 已用其它端口启动时必须填同一个端口'),
  devtoolsTimeoutSec: Schema.number()
    .default(90)
    .description('调用开发者工具 CLI 的超时秒数；IDE 冷启动较慢，默认 90 秒'),
  previewDir: Schema.string().default('').description('预览二维码图片的保存目录；留空则写到系统临时目录'),
})
