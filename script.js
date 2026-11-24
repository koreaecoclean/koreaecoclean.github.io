/* ============================================================
   코리아 에코크린 — 인터랙션 스크립트
   ============================================================ */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* 스크롤 등장 애니메이션은 스크립트가 정상 동작할 때만 켭니다(자바스크립트 오류 시 내용이 숨지 않도록) */
  if (!reduceMotion) root.classList.add('reveal-ready');

  /* ---------- 연도 ---------- */
  var yearEl = doc.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------- 스크롤 진행 바 / 헤더 / 퀵바 ---------- */
  var header = doc.getElementById('siteHeader');
  var progressBar = doc.getElementById('progressBar');
  var quickBar = doc.getElementById('quickBar');
  var ticking = false;

  function onScroll() {
    var y = window.scrollY || window.pageYOffset;

    if (header) header.classList.toggle('scrolled', y > 12);

    if (progressBar) {
      var max = doc.documentElement.scrollHeight - window.innerHeight;
      var pct = max > 0 ? Math.min(100, (y / max) * 100) : 0;
      progressBar.style.width = pct + '%';
    }

    if (quickBar) {
      quickBar.classList.toggle('is-visible', y > 260);
      var nearBottom = y + window.innerHeight > doc.documentElement.scrollHeight - 520;
      quickBar.classList.toggle('at-bottom', nearBottom);
    }

    ticking = false;
  }

  window.addEventListener('scroll', function () {
    if (!ticking) {
      ticking = true;
      window.requestAnimationFrame(onScroll);
    }
  }, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  onScroll();

  /* ---------- 모바일 메뉴 ---------- */
  var navToggle = doc.getElementById('navToggle');
  var mobileNav = doc.getElementById('mobileNav');

  function closeNav() {
    if (!navToggle || !mobileNav) return;
    navToggle.setAttribute('aria-expanded', 'false');
    navToggle.setAttribute('aria-label', '메뉴 열기');
    header.classList.remove('nav-open');
    mobileNav.hidden = true;
  }

  if (navToggle && mobileNav) {
    navToggle.addEventListener('click', function () {
      var open = navToggle.getAttribute('aria-expanded') === 'true';
      if (open) {
        closeNav();
      } else {
        navToggle.setAttribute('aria-expanded', 'true');
        navToggle.setAttribute('aria-label', '메뉴 닫기');
        header.classList.add('nav-open');
        mobileNav.hidden = false;
      }
    });

    mobileNav.addEventListener('click', function (e) {
      if (e.target.closest('a')) closeNav();
    });

    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeNav();
    });

    doc.addEventListener('click', function (e) {
      if (mobileNav.hidden) return;
      if (!e.target.closest('.header-shell')) closeNav();
    });
  }

  /* ---------- 스크롤 등장 애니메이션 ---------- */
  var revealEls = Array.prototype.slice.call(doc.querySelectorAll('[data-reveal]'));

  function revealAll() {
    revealEls.forEach(function (el) { el.classList.add('is-in'); });
  }

  if (!('IntersectionObserver' in window) || reduceMotion) {
    revealAll();
  } else {
    var revealIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          revealIO.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -6% 0px' });

    revealEls.forEach(function (el) { revealIO.observe(el); });

    /* 안전장치: 3초 뒤에도 화면 안에 남은 요소는 확실히 보이게 */
    window.setTimeout(function () {
      revealEls.forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) el.classList.add('is-in');
      });
    }, 2600);
  }

  /* ---------- 숫자 카운트업 ---------- */
  var counters = Array.prototype.slice.call(doc.querySelectorAll('.count'));

  function runCount(el) {
    var target = parseFloat(el.getAttribute('data-count'));
    var suffix = el.getAttribute('data-suffix') || '';
    if (isNaN(target)) return;

    if (reduceMotion) {
      el.textContent = target + suffix;
      return;
    }

    var duration = 1500;
    var startTime = null;

    function step(now) {
      if (startTime === null) startTime = now;
      var p = Math.min(1, (now - startTime) / duration);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased) + suffix;
      if (p < 1) window.requestAnimationFrame(step);
      else el.textContent = target + suffix;
    }
    window.requestAnimationFrame(step);
  }

  if (counters.length) {
    if (!('IntersectionObserver' in window)) {
      counters.forEach(function (el) {
        el.textContent = el.getAttribute('data-count') + (el.getAttribute('data-suffix') || '');
      });
    } else {
      var countIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            runCount(entry.target);
            countIO.unobserve(entry.target);
          }
        });
      }, { threshold: 0.5 });
      counters.forEach(function (el) { countIO.observe(el); });
    }
  }

  /* ---------- 서비스 카드 상세 펼치기 ---------- */
  Array.prototype.forEach.call(doc.querySelectorAll('.service-toggle'), function (btn) {
    btn.addEventListener('click', function () {
      var card = btn.closest('.service-card');
      var open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', open ? 'false' : 'true');
      card.classList.toggle('open', !open);
      btn.querySelector('span').textContent = open ? '상세 보기' : '접기';
    });
  });

  /* ---------- 현장 사진 필터 ---------- */
  var filterBtns = Array.prototype.slice.call(doc.querySelectorAll('.filter'));
  var shots = Array.prototype.slice.call(doc.querySelectorAll('.shot'));

  filterBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var key = btn.getAttribute('data-filter');
      filterBtns.forEach(function (b) {
        var active = b === btn;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      shots.forEach(function (shot) {
        var show = key === 'all' || shot.getAttribute('data-cat') === key;
        shot.classList.toggle('is-hidden', !show);
      });
    });
  });

  /* ---------- 라이트박스 ---------- */
  var lightbox = doc.getElementById('lightbox');
  var lbImage = doc.getElementById('lbImage');
  var lbCaption = doc.getElementById('lbCaption');
  var lbClose = doc.getElementById('lbClose');
  var lbPrev = doc.getElementById('lbPrev');
  var lbNext = doc.getElementById('lbNext');
  var lastFocus = null;
  var lbIndex = 0;

  function visibleShots() {
    return shots.filter(function (s) { return !s.classList.contains('is-hidden'); });
  }

  function showSlide(i) {
    var list = visibleShots();
    if (!list.length) return;
    lbIndex = (i + list.length) % list.length;
    var shot = list[lbIndex];
    var img = shot.querySelector('img');
    var cap = shot.querySelector('figcaption');
    lbImage.src = img.getAttribute('src');
    lbImage.alt = img.getAttribute('alt') || '';
    lbCaption.textContent = cap ? cap.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  function openLightbox(shot) {
    var list = visibleShots();
    lbIndex = list.indexOf(shot);
    lastFocus = doc.activeElement;
    showSlide(lbIndex);
    lightbox.hidden = false;
    doc.body.style.overflow = 'hidden';
    lbClose.focus();
  }

  function closeLightbox() {
    lightbox.hidden = true;
    doc.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  shots.forEach(function (shot) {
    var btn = shot.querySelector('.shot-btn');
    if (!btn) return;
    btn.addEventListener('click', function () { openLightbox(shot); });
  });

  if (lightbox) {
    lbClose.addEventListener('click', closeLightbox);
    lbPrev.addEventListener('click', function () { showSlide(lbIndex - 1); });
    lbNext.addEventListener('click', function () { showSlide(lbIndex + 1); });

    lightbox.addEventListener('click', function (e) {
      if (e.target === lightbox) closeLightbox();
    });

    doc.addEventListener('keydown', function (e) {
      if (lightbox.hidden) return;
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowLeft') showSlide(lbIndex - 1);
      else if (e.key === 'ArrowRight') showSlide(lbIndex + 1);
      else if (e.key === 'Tab') {
        var focusables = [lbClose, lbPrev, lbNext];
        var idx = focusables.indexOf(doc.activeElement);
        e.preventDefault();
        var next = (idx + (e.shiftKey ? -1 : 1) + focusables.length) % focusables.length;
        focusables[next].focus();
      }
    });
  }

  /* ---------- 예약 상담 폼 ---------- */
  var form = doc.getElementById('bookingForm');
  if (form) {
    var areaInput = doc.getElementById('areaInput');
    var telInput = doc.getElementById('telInput');
    var cycleInput = doc.getElementById('cycleInput');
    var memoInput = doc.getElementById('memoInput');
    var resultText = doc.getElementById('resultText');
    var resultTitle = doc.getElementById('resultTitle');
    var resultBadge = doc.getElementById('resultBadge');
    var resultEmpty = doc.getElementById('resultEmpty');
    var resultHelp = doc.getElementById('resultHelp');
    var resultPanel = doc.querySelector('.booking-result');
    var smsBtn = doc.getElementById('smsBtn');
    var copyBtn = doc.getElementById('copyBtn');
    var submitBtn = doc.getElementById('submitBtn');
    var currentText = '';
    var submitted = false;

    function currentSpace() {
      var checked = form.querySelector('input[name="space"]:checked');
      return checked ? checked.value : '';
    }

    function buildMessage() {
      var area = areaInput.value.trim();
      var tel = telInput.value.trim();
      var memo = memoInput.value.trim();
      currentText =
        '[코리아 에코크린 방문견적 · 예약 상담]\n' +
        '· 공간 유형: ' + (currentSpace() || '-') + '\n' +
        '· 지역: ' + (area || '-') + '\n' +
        '· 희망 주기: ' + cycleInput.value + '\n' +
        '· 연락처: ' + (tel || '-') + '\n' +
        '· 메모: ' + (memo || '-');
      return currentText;
    }

    function renderPreview() {
      buildMessage();
      if (!submitted) resultText.textContent = currentText;
    }

    function setActive(on) {
      [smsBtn, copyBtn].forEach(function (el) {
        if (!el) return;
        el.classList.toggle('is-disabled', !on);
        el.setAttribute('aria-disabled', on ? 'false' : 'true');
        if (el.tagName === 'BUTTON') el.disabled = !on;
      });
    }

    function resetSubmitted() {
      if (!submitted) return;
      submitted = false;
      resultPanel.classList.remove('is-done');
      resultBadge.textContent = '신청 내용';
      resultTitle.textContent = '적으신 내용이 여기에 정리됩니다';
      resultEmpty.hidden = false;
      resultHelp.textContent = '‘상담 내용 확인하기’를 누르면 문자·복사 버튼이 활성화됩니다.';
      setActive(false);
      renderPreview();
    }

    function clearError(input) {
      input.closest('.field').classList.remove('has-error');
      var err = doc.querySelector('[data-error-for="' + input.id + '"]');
      if (err) err.hidden = true;
    }

    function showError(input) {
      input.closest('.field').classList.add('has-error');
      var err = doc.querySelector('[data-error-for="' + input.id + '"]');
      if (err) err.hidden = false;
    }

    function validate() {
      var ok = true;
      if (!areaInput.value.trim()) { showError(areaInput); ok = false; }
      else clearError(areaInput);

      var digits = telInput.value.replace(/[^0-9]/g, '');
      if (digits.length < 8) { showError(telInput); ok = false; }
      else clearError(telInput);

      return ok;
    }

    ['input', 'change'].forEach(function (evt) {
      form.addEventListener(evt, function (e) {
        if (e.target === areaInput) clearError(areaInput);
        if (e.target === telInput) clearError(telInput);
        resetSubmitted();
        renderPreview();
      });
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!validate()) {
        var firstError = form.querySelector('.has-error input');
        if (firstError) firstError.focus();
        return;
      }

      buildMessage();
      submitted = true;

      resultPanel.classList.add('is-done');
      resultBadge.textContent = '접수 내용 확인';
      resultTitle.textContent = '아래 내용으로 상담을 신청하시겠어요?';
      resultText.textContent = currentText;
      resultEmpty.hidden = true;
      resultHelp.textContent = '문자로 보내면 대표 번호(0507-1317-8369)로 바로 전송됩니다.';
      setActive(true);

      if (smsBtn) {
        smsBtn.href = 'sms:0507-1317-8369?body=' + encodeURIComponent(currentText);
      }

      if (window.innerWidth < 980) {
        resultPanel.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
      }

      if (submitBtn) {
        var label = submitBtn.childNodes[0];
        if (label && label.nodeType === 3) label.textContent = '내용 확인 완료 · 문자로 보내기 ';
      }
    });

    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var text = currentText || buildMessage();
        var done = function () {
          var span = copyBtn.querySelector('span');
          var original = '내용 복사';
          if (span) {
            span.textContent = '복사되었습니다';
            window.setTimeout(function () { span.textContent = original; }, 1800);
          }
        };

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
        } else {
          fallbackCopy(text, done);
        }
      });
    }

    function fallbackCopy(text, done) {
      var ta = doc.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      doc.body.appendChild(ta);
      ta.select();
      try { doc.execCommand('copy'); done(); } catch (err) { /* 무시 */ }
      doc.body.removeChild(ta);
    }

    setActive(false);
    renderPreview();
  }

  /* ---------- 부드러운 앵커 이동(헤더 높이 보정은 CSS scroll-padding 사용) ---------- */
  doc.addEventListener('click', function (e) {
    var link = e.target.closest('a[href^="#"]');
    if (!link) return;
    var id = link.getAttribute('href');
    if (!id || id === '#') return;
    var target = doc.querySelector(id);
    if (!target) return;
    /* 메뉴가 열려 있으면 닫기 */
    closeNav();
  });

  /* ---------- 맨 위로 ---------- */
  var topBtn = doc.getElementById('topBtn');
  if (topBtn) {
    topBtn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    });
  }
})();
