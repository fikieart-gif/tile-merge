/** Полёт тайла при merge; зависимости в api из index.html.
 *  transform только на .cell-face — не на .cell (WebKit + overflow:hidden у .game). */
function animateMergeSequence(pairs, onDone, levels, api) {
  const getGridCellsSnapshot = api.getGridCellsSnapshot;
  const registerPendingMergeCoeff = api.registerPendingMergeCoeff;
  const coeffGainLabelForMerge = api.coeffGainLabelForMerge;

  if (!pairs || pairs.length === 0) {
    onDone();
    return;
  }

  const MERGE_FLIGHT_MS = 55;
  const MERGE_FLIGHT_EASING = "cubic-bezier(0.62, 0.054, 0.738, 0.145)";

  let remaining = pairs.length;
  function finishOneFlight() {
    remaining--;
    if (remaining <= 0) {
      onDone();
    }
  }

  const gridCells = getGridCellsSnapshot();

  /* Один rAF на весь шаг: к этому кадру уже применены стили/лейаут (в т.ч. merge-pending),
     иначе getBoundingClientRect до отрисовки даёт неверный dx/dy → WAAPI с нулевым смещением
     и «мгновенный» merge без видимого полёта. */
  requestAnimationFrame(function () {
    pairs.forEach(function (pair) {
      const anchorIdx = pair[0];
      const moverIdx = pair[1];
      const anchorCell = gridCells[anchorIdx];
      const moverCell = gridCells[moverIdx];
      const anchorFace = anchorCell && anchorCell.querySelector(".cell-face");
      const moverFace = moverCell && moverCell.querySelector(".cell-face");

      if (!anchorCell || !moverCell || !anchorFace || !moverFace) {
        finishOneFlight();
        return;
      }

      const rectAnchor = anchorFace.getBoundingClientRect();
      const rectMover = moverFace.getBoundingClientRect();
      const dx = rectAnchor.left - rectMover.left;
      const dy = rectAnchor.top - rectMover.top;

      moverCell.style.zIndex = "50";
      moverFace.style.overflow = "visible";
      moverFace.style.opacity = "1";

      moverFace.style.transition = "none";
      moverFace.style.transform = "translate3d(0, 0, 0)";
      void moverFace.offsetWidth;

      let finished = false;
      const runAfterFlight = function () {
        if (finished) return;
        finished = true;

        const L = levels && levels[anchorIdx];
        const gain = coeffGainLabelForMerge(L);
        if (gain != null) {
          registerPendingMergeCoeff(anchorIdx, gain);
        }

        moverFace.style.opacity = "0";
        moverCell.style.zIndex = "";
        moverFace.style.overflow = "";
        moverFace.style.transition = "";
        moverFace.style.transform = "";
        moverFace.style.willChange = "";
        finishOneFlight();
      };

      const armSafety = function (cancelFn) {
        return window.setTimeout(function () {
          try {
            if (typeof cancelFn === "function") {
              cancelFn();
            }
          } catch (e) {}
          runAfterFlight();
        }, MERGE_FLIGHT_MS + 70);
      };

      try {
        if (typeof moverFace.getAnimations === "function") {
          moverFace.getAnimations().forEach(function (a) {
            try {
              a.cancel();
            } catch (e) {}
          });
        }
      } catch (e) {}

      moverFace.style.willChange = "transform";

      let waapiAnim = null;
      if (typeof moverFace.animate === "function") {
        try {
          waapiAnim = moverFace.animate(
            [
              {
                transform: "translate3d(0, 0, 0)",
                easing: MERGE_FLIGHT_EASING,
              },
              {
                transform: "translate3d(" + dx + "px, " + dy + "px, 0)",
              },
            ],
            { duration: MERGE_FLIGHT_MS, fill: "forwards" }
          );
        } catch (e) {
          waapiAnim = null;
        }
      }

      if (waapiAnim && waapiAnim.finished && typeof waapiAnim.finished.then === "function") {
        let safety = armSafety(function () {
          try {
            waapiAnim.cancel();
          } catch (e) {}
        });
        const clearSafety = function () {
          if (safety != null) {
            clearTimeout(safety);
            safety = null;
          }
        };
        waapiAnim.finished
          .then(function () {
            clearSafety();
            runAfterFlight();
          })
          .catch(function () {
            clearSafety();
            runAfterFlight();
          });
      } else if (!waapiAnim) {
        let safety = null;
        const onTransitionEnd = function (e) {
          if (e.target !== moverFace) return;
          if (e.propertyName !== "transform" && e.propertyName !== "-webkit-transform") {
            return;
          }
          moverFace.removeEventListener("transitionend", onTransitionEnd);
          if (safety != null) {
            clearTimeout(safety);
          }
          runAfterFlight();
        };
        safety = window.setTimeout(function () {
          moverFace.removeEventListener("transitionend", onTransitionEnd);
          runAfterFlight();
        }, MERGE_FLIGHT_MS + 70);
        moverFace.addEventListener("transitionend", onTransitionEnd);
        moverFace.style.transition =
          "transform " + MERGE_FLIGHT_MS / 1000 + "s " + MERGE_FLIGHT_EASING;
        moverFace.style.transform = "translate3d(" + dx + "px, " + dy + "px, 0)";
      } else {
        armSafety(function () {
          try {
            waapiAnim.cancel();
          } catch (e) {}
        });
      }
    });
  });
}

(function (global) {
  global.MergeGameAnimations = global.MergeGameAnimations || {};
  global.MergeGameAnimations.animateMergeSequence = animateMergeSequence;
})(typeof window !== "undefined" ? window : globalThis);
