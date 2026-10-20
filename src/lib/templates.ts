/** 页面 / 组件 / 工程骨架模板。生成即合法的原生小程序代码。 */

export interface PageTemplateOptions {
  title: string
  /** 是否生成 wxss（默认 true） */
  withStyle?: boolean
  /** 是否生成页面 json（默认 true） */
  withJson?: boolean
  /** 页面描述，写进注释里给后续维护者 */
  description?: string
}

export const pageWxml = (title: string): string => `<view class="page">
  <view class="title">${escapeXml(title)}</view>
</view>
`

export const pageWxss = `.page {
  padding: 32rpx;
}

.title {
  font-size: 36rpx;
  font-weight: 600;
  color: #1a1a1a;
}
`

export const pageJs = (title: string): string => `Page({
  data: {
    title: '${escapeJs(title)}',
  },

  onLoad() {
    // TODO: 初始化数据
  },
})
`

export const pageTs = (title: string): string => `Page({
  data: {
    title: '${escapeJs(title)}',
  },

  onLoad() {
    // TODO: 初始化数据
  },
})
`

export const pageJson = (title: string, usingComponents: Record<string, string> = {}): string =>
  `${JSON.stringify({ navigationBarTitleText: title, usingComponents }, null, 2)}\n`

export const componentWxml = (name: string): string => `<view class="${name}">
  <slot></slot>
</view>
`

export const componentWxss = (name: string): string => `.${name} {
  display: block;
}
`

export const componentJs = (): string => `Component({
  properties: {},

  data: {},

  methods: {},
})
`

export const componentJson = (): string =>
  `${JSON.stringify({ component: true, styleIsolation: 'apply-shared', usingComponents: {} }, null, 2)}\n`

export const appJs = (): string => `App({
  globalData: {},

  onLaunch() {
    // TODO: 登录、埋点等启动逻辑
  },
})
`

export const appJson = (pages: string[], window: Record<string, unknown>): string =>
  `${JSON.stringify({ pages, window, sitemapLocation: 'sitemap.json' }, null, 2)}\n`

export const appWxss = `page {
  background: #f6f7f9;
  color: #1a1a1a;
  font-size: 28rpx;
}
`

export const sitemapJson = (): string =>
  `${JSON.stringify({ desc: '关于本文件的更多信息，请参考文档 https://developers.weixin.qq.com/miniprogram/dev/framework/sitemap.html', rules: [{ action: 'allow', page: '*' }] }, null, 2)}\n`

export const projectConfigJson = (input: { appid: string; miniprogramRoot: string; compileType?: string; name?: string }): string => {
  const config: Record<string, unknown> = {
    description: `${input.name ?? '小程序'}项目配置文件`,
    packOptions: { ignore: [], include: [] },
    setting: {
      urlCheck: true,
      es6: true,
      enhance: true,
      postcss: true,
      preloadBackgroundData: false,
      minified: true,
      newFeature: false,
      coverView: true,
      nodeModules: false,
      autoAudits: false,
      showShadowRootInWxmlPanel: true,
      scopeDataCheck: false,
      uglifyFileName: false,
      checkInvalidKey: true,
      checkSiteMap: true,
      uploadWithSourceMap: true,
      compileHotReLoad: false,
      lazyloadPlaceholderEnable: false,
      useMultiFrameRuntime: true,
      useApiHook: true,
      useApiHostProcess: true,
      babelSetting: { ignore: [], disablePlugins: [], outputPath: '' },
      useIsolateContext: true,
      useCompilerModule: false,
      userConfirmedUseCompilerModuleSwitch: false,
    },
    compileType: input.compileType ?? 'miniprogram',
    libVersion: 'latest',
    appid: input.appid,
    projectname: input.name ?? 'miniprogram',
  }
  if (input.miniprogramRoot !== '') config.miniprogramRoot = input.miniprogramRoot
  else config.miniprogramRoot = 'miniprogram/'
  return `${JSON.stringify(config, null, 2)}\n`
}

export const gitignore = `node_modules/
miniprogram_npm/
.DS_Store
project.private.config.json
`

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function escapeJs(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')
}
