// The `/doctor` rows that answer "is anything still watching?".
//
// Its own table because `ctrl.mjs` sits at the 500-line ceiling and these six
// keys belong to one row group: the restart marker and the age of the last
// supervisor tick. Age is formatted elsewhere and only interpolated here.
export default {
  'ctrl.doctor.restartMarker': 'Restart marker',
  'ctrl.doctor.restartMarkerSet': 'set {age} ago',
  'ctrl.doctor.restartMarkerClear': 'none',
  'ctrl.doctor.kickAge': 'Supervisor',
  'ctrl.doctor.kickAgo': 'last tick {age} ago',
  'ctrl.doctor.kickMissing': 'no tick yet',
};