/** 页面 / 组件 / 工程骨架模板。生成即合法的原生小程序代码。 */
export const pageWxml = (title) => `<view class="page">
  <view class="title">${escapeXml(title)}</view>
</view>
`;
export const pageWxss = `.page {
  padding: 32rpx;
}

.title {
  font-size: 36rpx;
  font-weight: 600;
  color: #1a1a1a;
}
`;
export const pageJs = (title) => `Page({
  data: {
    title: '${escapeJs(title)}',
  },

  onLoad() {
    // TODO: 初始化数据
  },
})
`;
export const pageTs = (title) => `Page({
  data: {
    title: '${escapeJs(title)}',
  },

  onLoad() {
    // TODO: 初始化数据
  },
})
`;
export const pageJson = (title, usingComponents = {}) => `${JSON.stringify({ navigationBarTitleText: title, usingComponents }, null, 2)}\n`;
export const componentWxml = (name) => `<view class="${name}">
  <slot></slot>
</view>
`;
export const componentWxss = (name) => `.${name} {
  display: block;
}
`;
export const componentJs = () => `Component({
  properties: {},

  data: {},

  methods: {},
})
`;
export const componentJson = () => `${JSON.stringify({ component: true, styleIsolation: 'apply-shared', usingComponents: {} }, null, 2)}\n`;
export const appJs = () => `App({
  globalData: {},

  onLaunch() {
    // TODO: 登录、埋点等启动逻辑
  },
})
`;
export const appJson = (pages, window) => `${JSON.stringify({ pages, window, sitemapLocation: 'sitemap.json' }, null, 2)}\n`;
export const appWxss = `page {
  background: #f6f7f9;
  color: #1a1a1a;
  font-size: 28rpx;
}
`;
export const sitemapJson = () => `${JSON.stringify({ desc: '关于本文件的更多信息，请参考文档 https://developers.weixin.qq.com/miniprogram/dev/framework/sitemap.html', rules: [{ action: 'allow', page: '*' }] }, null, 2)}\n`;
export const projectConfigJson = (input) => {
    const config = {
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
    };
    if (input.miniprogramRoot !== '')
        config.miniprogramRoot = input.miniprogramRoot;
    else
        config.miniprogramRoot = 'miniprogram/';
    return `${JSON.stringify(config, null, 2)}\n`;
};
export const gitignore = `node_modules/
miniprogram_npm/
.DS_Store
project.private.config.json
`;
function escapeXml(value) {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escapeJs(value) {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}
