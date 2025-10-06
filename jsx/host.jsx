/*
 * host.jsx — бизнес-логика синхронизации клипов для панели GARSUS Prod
 */

(function () {
  if (typeof JSON === 'undefined') {
    JSON = {};
  }

  if (!JSON.parse) {
    JSON.parse = function (text) {
      return eval('(' + text + ')');
    };
  }

  if (!JSON.stringify) {
    JSON.stringify = function (value) {
      if (value === null) {
        return 'null';
      }
      var type = typeof value;
      if (type === 'number' || type === 'boolean') {
        return value.toString();
      }
      if (type === 'string') {
        return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
      }
      if (value instanceof Array) {
        var items = [];
        for (var i = 0; i < value.length; i++) {
          items.push(JSON.stringify(value[i]));
        }
        return '[' + items.join(',') + ']';
      }
      var props = [];
      for (var key in value) {
        if (value.hasOwnProperty(key)) {
          props.push('"' + key + '"' + ':' + JSON.stringify(value[key]));
        }
      }
      return '{' + props.join(',') + '}';
    };
  }

  var TICKS_PER_SECOND = 254016000.0;
  var DAY_LIMIT_SECONDS = 24 * 60 * 60;
  var AUDIO_RANGES = [
    { start: 0, end: 2 }, // V1 -> A1-A3
    { start: 6, end: 8 }, // V2 -> A7-A9
    { start: 3, end: 5 }  // V3 -> A4-A6
  ];

  function secondsToTicks(seconds) {
    return Math.floor(seconds * TICKS_PER_SECOND);
  }

  function ticksToSeconds(ticks) {
    if (!ticks) {
      return 0;
    }
    return Math.floor(ticks / TICKS_PER_SECOND);
  }

  function parseTimecodeFromName(name) {
    if (!name) {
      return null;
    }
    var re = /(\d{4})-(\d{2})-(\d{2})[ _](\d{2})-(\d{2})-(\d{2})/;
    var match = re.exec(name);
    if (!match) {
      return null;
    }
    var hours = parseInt(match[4], 10);
    var minutes = parseInt(match[5], 10);
    var seconds = parseInt(match[6], 10);
    if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) {
      return null;
    }
    return hours * 3600 + minutes * 60 + seconds;
  }

  function ensureQE() {
    if (app.enableQE) {
      try {
        app.enableQE();
      } catch (err) {
        return false;
      }
      return true;
    }
    return false;
  }

  function ensureTracks(seq) {
    var ok = true;
    var neededVideo = 3 - seq.videoTracks.numTracks;
    var neededAudio = 9 - seq.audioTracks.numTracks;
    if (neededVideo <= 0 && neededAudio <= 0) {
      return ok;
    }
    try {
      if (ensureQE()) {
        var qeSeq = qe.project.getActiveSequence();
        if (qeSeq) {
          qeSeq.addTracks(neededVideo > 0 ? neededVideo : 0, neededAudio > 0 ? neededAudio : 0);
        } else {
          ok = false;
        }
      } else {
        ok = false;
      }
    } catch (e) {
      ok = false;
    }
    return ok;
  }

  function muteTargetTracks(seq) {
    for (var v = 0; v < 3; v++) {
      try {
        if (v < seq.videoTracks.numTracks) {
          seq.videoTracks[v].setMute(true);
        }
      } catch (err) {}
    }
    for (var a = 0; a < 9; a++) {
      try {
        if (a < seq.audioTracks.numTracks) {
          seq.audioTracks[a].setMute(true);
        }
      } catch (err2) {}
    }
  }

  function probeDuration(projectItem, messages, startIsBegin, defaultReplayLen) {
    try {
      var mediaDuration = projectItem.getMediaDuration();
      if (mediaDuration && mediaDuration > 0) {
        return Math.max(1, ticksToSeconds(mediaDuration));
      }
    } catch (err) {}

    try {
      if (ensureQE()) {
        var projectPath = projectItem.getMediaPath ? projectItem.getMediaPath() : '';
        if (projectPath && qe && qe.project && qe.project.getItemFromPath) {
          var qeItem = qe.project.getItemFromPath(projectPath);
          if (qeItem && qeItem.mediaDuration) {
            var qeDuration = qeItem.mediaDuration();
            if (qeDuration && qeDuration > 0) {
              return Math.max(1, ticksToSeconds(qeDuration));
            }
          }
        }
      }
    } catch (err2) {}

    var fallback = startIsBegin ? 1 : defaultReplayLen;
    messages.push('DURATION UNKNOWN -> using ' + fallback + ' (' + projectItem.name + ')');
    return fallback;
  }

  function safeSetInOut(projectItem, inPoint, outPoint) {
    try {
      projectItem.setInPoint(inPoint);
    } catch (err) {}
    try {
      projectItem.setOutPoint(outPoint);
    } catch (err2) {}
  }

  function clearInOut(projectItem) {
    try {
      projectItem.clearInPoint();
    } catch (err) {}
    try {
      projectItem.clearOutPoint();
    } catch (err2) {}
  }

  function safeMoveToTrack(trackItem, isAudio, trackIndex) {
    if (!trackItem) {
      return false;
    }
    var moved = false;
    try {
      trackItem.moveToTrack(isAudio ? 1 : 0, trackIndex);
      moved = true;
    } catch (err) {}
    if (!moved) {
      try {
        trackItem.moveToTrack(trackIndex, isAudio ? 1 : 0);
        moved = true;
      } catch (err2) {}
    }
    return moved;
  }

  function moveLinkedAudio(videoTrackItem, trackIndex) {
    if (!videoTrackItem || !videoTrackItem.getLinkedItems) {
      return;
    }
    var linked = videoTrackItem.getLinkedItems();
    if (!linked || linked.length === 0) {
      return;
    }
    var range = AUDIO_RANGES[trackIndex] || AUDIO_RANGES[0];
    var target = range.start;
    for (var i = 0; i < linked.length; i++) {
      var item = linked[i];
      try {
        if (item && item.mediaType && item.mediaType.toLowerCase() === 'audio') {
          safeMoveToTrack(item, true, target);
          if (target < range.end) {
            target++;
          }
        }
      } catch (err) {}
    }
  }

  function collectTrackItems(track) {
    var items = [];
    if (!track || !track.clips || track.clips.numItems === 0) {
      return items;
    }
    for (var i = 0; i < track.clips.numItems; i++) {
      items.push(track.clips[i]);
    }
    return items;
  }

  function garsus_syncTrack(payloadStr) {
    try {
      var options = JSON.parse(payloadStr);
      var seq = app.project && app.project.activeSequence;
      if (!seq) {
        return 'NO SEQUENCE';
      }

      var trackIndex = options.trackIndex;
      var track = seq.videoTracks && seq.videoTracks.numTracks > trackIndex ? seq.videoTracks[trackIndex] : null;
      var rawItems = collectTrackItems(track);
      var messages = [];
      var results = [];
      var noParseCount = 0;

      for (var i = 0; i < rawItems.length; i++) {
        var trackItem = rawItems[i];
        var projectItem = trackItem.projectItem;
        if (!projectItem) {
          continue;
        }
        var parsed = parseTimecodeFromName(projectItem.name);
        if (parsed === null) {
          noParseCount++;
          continue;
        }
        var duration = probeDuration(projectItem, messages, options.startIsBegin, options.defaultReplayLength);
        var startBase = options.startIsBegin ? parsed : (parsed - duration);
        var start = startBase + options.offsetSeconds;
        results.push({
          projectItem: projectItem,
          name: projectItem.name,
          start: start,
          duration: duration,
          inPoint: 0
        });
      }

      if (results.length === 0) {
        return 'NO PARSEABLE ITEMS (V' + (trackIndex + 1) + ')';
      }

      results.sort(function (a, b) {
        return a.start - b.start;
      });

      var ensureOk = ensureTracks(seq);
      if (!ensureOk) {
        messages.push('WARN_NEED_TRACKS');
      }

      if (options.muteBeforeInsert) {
        muteTargetTracks(seq);
      }

      var summary = {
        placed: 0,
        skippedInside: 0,
        trimmedHeadSec: 0,
        clampedToZeroSec: 0,
        errors: 0,
        noParse: noParseCount
      };

      var lastEnd = 0;
      var firstPlacedStart = null;
      var videoTrack = seq.videoTracks[trackIndex];

      for (var r = 0; r < results.length; r++) {
        var entry = results[r];
        var start = Math.floor(entry.start);
        var duration = Math.max(1, Math.floor(entry.duration));
        var inPoint = entry.inPoint;

        if (start < 0) {
          var cutToZero = Math.min(duration, -start);
          if (cutToZero >= duration) {
            summary.skippedInside++;
            continue;
          }
          start = 0;
          duration -= cutToZero;
          inPoint += cutToZero;
          summary.trimmedHeadSec += cutToZero;
          summary.clampedToZeroSec += cutToZero;
        }

        if (start >= DAY_LIMIT_SECONDS) {
          summary.skippedInside++;
          continue;
        }

        if (start < lastEnd) {
          var overlapCut = lastEnd - start;
          if (overlapCut >= duration) {
            summary.skippedInside++;
            continue;
          }
          start = lastEnd;
          duration -= overlapCut;
          inPoint += overlapCut;
          summary.trimmedHeadSec += overlapCut;
        }

        var end = start + duration;
        if (end > DAY_LIMIT_SECONDS) {
          var clamp = end - DAY_LIMIT_SECONDS;
          if (clamp >= duration) {
            summary.skippedInside++;
            continue;
          }
          duration -= clamp;
        }

        try {
          safeSetInOut(entry.projectItem, inPoint, inPoint + duration);
          videoTrack = seq.videoTracks[trackIndex];
          var inserted = videoTrack.insertClip(entry.projectItem, start);
          if (inserted) {
            moveLinkedAudio(inserted, trackIndex);
            summary.placed++;
            lastEnd = Math.max(lastEnd, start + duration);
            if (firstPlacedStart === null) {
              firstPlacedStart = start;
            }
          } else {
            summary.errors++;
            messages.push('INSERT FAIL: ' + entry.name);
          }
        } catch (err3) {
          summary.errors++;
          messages.push('INSERT FAIL: ' + entry.name + ' — ' + err3);
        } finally {
          clearInOut(entry.projectItem);
        }
      }

      if (summary.placed > 0 && firstPlacedStart !== null && seq.setPlayerPosition) {
        try {
          seq.setPlayerPosition(secondsToTicks(firstPlacedStart));
        } catch (err4) {}
      }

      var summaryLine = 'OK[V' + (trackIndex + 1) + '] placed=' + summary.placed +
        '  skippedInside=' + summary.skippedInside +
        '  trimmedHeadSec=' + summary.trimmedHeadSec +
        '  clampedToZeroSec=' + summary.clampedToZeroSec +
        '  errors=' + summary.errors +
        '  noParse=' + summary.noParse;

      if (messages.length > 0) {
        summaryLine += '\n' + messages.join('\n');
      }
      return summaryLine;
    } catch (err) {
      return 'HOST ERROR: ' + err;
    }
  }

  $.global.garsus_syncTrack = garsus_syncTrack;
})();
