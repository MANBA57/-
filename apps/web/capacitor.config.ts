import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor 配置。
 *
 * 关键点：APK 里的页面跑在 WebView 的 `https://localhost` 源上，
 * **相对路径 `/api/...` 会解析到那个不存在的地址**，所以打包时必须用
 * VITE_API_BASE 注入绝对后端地址：
 *
 *   生产：VITE_API_BASE=https://<你的域名>   → 同源 HTTPS，无需放行混合内容
 *   联调：VITE_API_BASE=http://<局域网IP>:8000 → 需放行混合内容（见下）
 *
 * allowMixedContent 放开「HTTPS 页面请求 HTTP 资源」的混合内容检查；
 * cleartext 放开 Android 9+ 的系统级明文流量拦截（usesCleartextTraffic）——
 * 两者缺一不可：只开前者，所有 /api 请求仍会被系统网络层掐掉，
 * 表现为「手机上只有前端、后端加载失败」。
 */
const apiBase = process.env.VITE_API_BASE ?? ''
const isCleartextApi = apiBase.startsWith('http://')

const config: CapacitorConfig = {
  // Java 包名必须纯 ASCII，不能用中文
  appId: 'com.coinmuseum.qin',
  appName: '数字钱币库',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // API 是明文 HTTP 时必须开：Android 9+ 默认禁所有明文流量
    cleartext: isCleartextApi,
  },
  android: {
    // 明文 API 联调时才允许混合内容
    allowMixedContent: isCleartextApi,
  },
}

export default config
