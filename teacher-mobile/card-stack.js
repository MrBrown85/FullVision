/* card-stack.js — Swipeable card deck with touch gestures
   Renders a stack of 3 visible cards with depth. Swipe left/right to advance.
   Used by Students tab (browse) and reusable elsewhere. */

window.MCardStack = (function() {
  'use strict';

  /**
   * Create a card stack inside a container element.
   * @param {HTMLElement} containerEl - Mount point (should have .m-card-stack class)
   * @param {Array} cards - Array of data objects, one per card
   * @param {Object} opts
   * @param {Function} opts.renderCard(data, idx) - Returns HTML string for a card
   * @param {Function} [opts.onSwipe(dir, data, idx)] - Called after swipe completes ('left'|'right')
   * @param {Function} [opts.onTap(data, idx)] - Called on tap (no drag)
   * @returns {{ goTo, destroy, refresh, getCurrentIndex }}
   */
  function create(containerEl, cards, opts) {
    if (!containerEl || !cards || cards.length === 0) return null;

    var _cards = cards;
    var _idx = 0;
    var _renderCard = opts.renderCard;
    var _onSwipe = opts.onSwipe || function() {};
    var _onTap = opts.onTap || function() {};
    var _destroyed = false;
    var _animating = false;

    // Touch state
    var _startX = 0, _startY = 0, _startTime = 0;
    var _deltaX = 0, _isDragging = false, _committed = false;
    var _dragDir = null; // 'left' | 'right' — direction locked once per gesture
    var DEAD_ZONE = 10;
    var SWIPE_THRESHOLD = 100;
    var VELOCITY_THRESHOLD = 0.4; // px/ms

    // DOM
    var _els = []; // currently rendered card elements (up to 3)

    function _mod(n) {
      return ((n % _cards.length) + _cards.length) % _cards.length;
    }

    function _buildCard(idx, depth) {
      var el = document.createElement('div');
      el.className = 'm-card-stack-item';
      el.setAttribute('data-depth', String(depth));
      el.setAttribute('data-idx', String(idx));
      el.innerHTML = _renderCard(_cards[idx], idx);
      return el;
    }

    function _render() {
      containerEl.innerHTML = '';
      _els = [];
      var depth = Math.min(3, _cards.length);
      for (var d = depth - 1; d >= 0; d--) {
        var el = _buildCard(_mod(_idx + d), d);
        containerEl.appendChild(el);
        _els[d] = el;
      }
      _updateCounter();
    }

    // Swap depth-1 card to show the destination for the given drag direction.
    // Called once per gesture when direction is first locked in.
    function _updateBehindCard(dir) {
      var behindEl = _els[1];
      if (!behindEl) return;
      var behindIdx = dir === 'right' ? _mod(_idx - 1) : _mod(_idx + 1);
      behindEl.innerHTML = _renderCard(_cards[behindIdx], behindIdx);
      behindEl.setAttribute('data-idx', String(behindIdx));
    }

    function _updateCounter() {
      var counter = containerEl.querySelector('.m-card-counter');
      if (!counter) {
        counter = document.createElement('div');
        counter.className = 'm-card-counter';
        containerEl.appendChild(counter);
      }
      // Use a span for text so appended elements (e.g. customize button) survive updates
      var span = counter.querySelector('.m-card-counter-text');
      if (!span) {
        span = document.createElement('span');
        span.className = 'm-card-counter-text';
        counter.insertBefore(span, counter.firstChild);
      }
      span.textContent = (_idx + 1) + ' of ' + _cards.length;
    }

    // --- Touch handlers ---

    function _onTouchStart(e) {
      if (_destroyed || _animating) return;
      var touch = e.touches[0];
      _startX = touch.clientX;
      _startY = touch.clientY;
      _startTime = Date.now();
      _deltaX = 0;
      _isDragging = false;
      _committed = false;
      _dragDir = null;
    }

    function _onTouchMove(e) {
      if (_destroyed || _committed) return;
      var touch = e.touches[0];
      var dx = touch.clientX - _startX;
      var dy = touch.clientY - _startY;

      if (!_isDragging) {
        if (Math.abs(dx) > DEAD_ZONE && Math.abs(dx) > Math.abs(dy)) {
          _isDragging = true;
          var active = _els[0];
          if (active) active.classList.add('m-card-dragging');
          e.preventDefault();
        } else if (Math.abs(dy) > DEAD_ZONE) {
          _committed = true;
          return;
        }
        return;
      }

      e.preventDefault();
      _deltaX = dx;

      // Lock drag direction on first significant movement and update peek card.
      var dir = dx < 0 ? 'left' : 'right';
      if (dir !== _dragDir) {
        _dragDir = dir;
        _updateBehindCard(dir);
      }

      var active = _els[0];
      if (active) {
        var rotate = dx * 0.04;
        active.style.transform = 'translateX(' + dx + 'px) rotate(' + rotate + 'deg)';
      }
    }

    function _onTouchEnd(e) {
      if (_destroyed) return;
      var active = _els[0];
      if (active) active.classList.remove('m-card-dragging');

      if (!_isDragging) {
        // It was a tap, not a drag
        if (Math.abs(_deltaX) < 5) {
          _onTap(_cards[_idx], _idx);
        }
        return;
      }

      var elapsed = Date.now() - _startTime;
      var velocity = Math.abs(_deltaX) / Math.max(elapsed, 1);
      var shouldSwipe = Math.abs(_deltaX) > SWIPE_THRESHOLD || velocity > VELOCITY_THRESHOLD;

      if (shouldSwipe && _deltaX < 0 && _cards.length > 1) {
        _animateExit('left');
      } else if (shouldSwipe && _deltaX > 0 && _cards.length > 1) {
        _animateExit('right');
      } else {
        // Spring back
        _springBack();
      }
    }

    function _springBack() {
      var active = _els[0];
      if (!active) return;
      active.classList.remove('m-card-dragging');
      active.classList.add('m-card-spring');
      active.style.transform = '';
      setTimeout(function() {
        if (active) active.classList.remove('m-card-spring');
      }, 350);
    }

    function _animateExit(dir) {
      var active = _els[0];
      if (!active) return;
      _animating = true;

      active.classList.remove('m-card-dragging');
      active.classList.add(dir === 'left' ? 'm-card-exit-left' : 'm-card-exit-right');

      var swipedIdx = _idx;
      var swipedData = _cards[_idx];

      // Advance index with wrap
      _idx = dir === 'left' ? _mod(_idx + 1) : _mod(_idx - 1);

      // Haptic
      if (typeof MComponents !== 'undefined' && MComponents.haptic) MComponents.haptic();

      setTimeout(function() {
        _animating = false;
        _render();
        _onSwipe(dir, swipedData, swipedIdx);
      }, 300);
    }

    // --- Public methods ---

    function goTo(idx) {
      if (idx < 0 || idx >= _cards.length) return;
      _idx = idx;
      _render();
    }

    function refresh(newCards) {
      _cards = newCards;
      if (_idx >= _cards.length) _idx = Math.max(0, _cards.length - 1);
      _render();
    }

    function getCurrentIndex() {
      return _idx;
    }

    function destroy() {
      _destroyed = true;
      containerEl.removeEventListener('touchstart', _onTouchStart);
      containerEl.removeEventListener('touchmove', _onTouchMove);
      containerEl.removeEventListener('touchend', _onTouchEnd);
      containerEl.innerHTML = '';
      _els = [];
    }

    // --- Init ---
    containerEl.addEventListener('touchstart', _onTouchStart, { passive: true });
    containerEl.addEventListener('touchmove', _onTouchMove, { passive: false });
    containerEl.addEventListener('touchend', _onTouchEnd, { passive: true });
    _render();

    return {
      goTo: goTo,
      destroy: destroy,
      refresh: refresh,
      getCurrentIndex: getCurrentIndex
    };
  }

  return { create: create };
})();
