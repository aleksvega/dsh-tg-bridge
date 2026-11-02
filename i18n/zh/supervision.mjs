// `/doctor` 里回答「还有没有东西在看守」的那两行。
//
// 单独一张表，因为 `ctrl.mjs` 已经贴着 500 行上限，而这六个键属于同一组行：
// 重启标记和上次守护检查的时间。时间在代码里算好，这里只做插值。
export default {
  'ctrl.doctor.restartMarker': '重启标记',
  'ctrl.doctor.restartMarkerSet': '{age} 前留下',
  'ctrl.doctor.restartMarkerClear': '无',
  'ctrl.doctor.kickAge': '守护进程',
  'ctrl.doctor.kickAgo': '上次检查 {age} 前',
  'ctrl.doctor.kickMissing': '还没有检查记录',
};