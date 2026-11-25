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
    if (cap) {
      var cat = cap.querySelector('span');
      var catText = cat ? cat.textContent.trim() : '';
      var restText = cap.textContent.replace(cat ? cat.textContent : '', '').trim();
      lbCaption.textContent = catText && restText ? catText + ' · ' + restText : (restText || catText);
    } else {
      lbCaption.textContent = '';
    }
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

    var isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    /* iOS는 ?body, 그 외는 ?body — 하이픈 없는 번호를 사용합니다 */
    function smsHref(text) {
      var sep = isIOSDevice ? '&' : '?';
      return 'sms:050713178369' + sep + 'body=' + encodeURIComponent(text);
    }

    function copyText(text, done) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
      } else {
        fallbackCopy(text, done);
      }
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
      resultHelp.textContent = '‘상담 신청하기’를 누르면 문자 앱이 열리고 신청 내용이 자동으로 복사됩니다.';
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
      resultBadge.textContent = '상담 신청';
      resultTitle.textContent = '신청 내용을 문자 앱으로 보냅니다';
      resultText.textContent = currentText;
      resultEmpty.hidden = true;
      resultHelp.textContent = '문자 앱이 열리면 전송 버튼을 눌러주세요. PC이거나 문자 앱이 열리지 않으면 아래 ‘내용 복사’ 후 0507-1317-8369로 보내주시거나 바로 전화 주세요.';
      setActive(true);

      if (smsBtn) smsBtn.href = smsHref(currentText);

      /* 내용은 미리 복사해 두고, 곧바로 문자 앱을 엽니다 */
      copyText(currentText, function () {});

      if (window.innerWidth < 980) {
        resultPanel.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
      }

      openSmsApp();
    });

    function openSmsApp() {
      var text = currentText || buildMessage();
      if (smsBtn) smsBtn.href = smsHref(text);
      try { window.location.href = smsHref(text); } catch (err) { /* 무시 */ }
    }

    if (smsBtn) {
      smsBtn.addEventListener('click', function (e) {
        if (smsBtn.getAttribute('aria-disabled') === 'true') {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        openSmsApp();
      });
    }

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

        copyText(text, done);
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

  /* ---------- 히어로 현장 영상 ---------- */
  var heroVideo = doc.getElementById('heroVideo');
  var heroMedia = doc.getElementById('heroMedia');
  var heroPlay = doc.getElementById('heroPlay');
  var heroFull = doc.getElementById('heroFull');

  function syncHeroState() {
    if (!heroVideo || !heroMedia) return;
    var paused = heroVideo.paused;
    heroMedia.classList.toggle('is-paused', paused);
    if (heroPlay) {
      heroPlay.setAttribute('aria-pressed', paused ? 'true' : 'false');
      heroPlay.setAttribute('aria-label', paused ? '현장 영상 재생' : '현장 영상 일시정지');
    }
  }

  if (heroVideo) {
    ['play', 'pause', 'loadeddata'].forEach(function (ev) {
      heroVideo.addEventListener(ev, syncHeroState);
    });

    if (reduceMotion) {
      heroVideo.pause();
      heroVideo.removeAttribute('autoplay');
      syncHeroState();
    }

    if (heroPlay) {
      heroPlay.addEventListener('click', function () {
        if (heroVideo.paused) heroVideo.play().catch(function () {});
        else heroVideo.pause();
      });
    }

    if (heroFull) {
      heroFull.addEventListener('click', function () {
        if (heroVideo.requestFullscreen) heroVideo.requestFullscreen().catch(function () {});
        else if (heroVideo.webkitEnterFullscreen) heroVideo.webkitEnterFullscreen();
      });
    }

    /* 소리 켜기 / 끄기 (자동재생은 무음으로 시작) */
    var heroSound = doc.getElementById('heroSound');

    function syncHeroSound() {
      if (!heroSound) return;
      var on = !heroVideo.muted;
      heroMedia.classList.toggle('is-sound', on);
      heroSound.setAttribute('aria-pressed', on ? 'true' : 'false');
      heroSound.setAttribute('aria-label', on ? '현장 영상 소리 끄기' : '현장 영상 소리 켜기');
      var label = heroSound.querySelector('.hero-sound-label');
      if (label) label.textContent = on ? '소리 끄기' : '소리 켜기';
    }

    if (heroSound) {
      heroSound.addEventListener('click', function () {
        heroVideo.muted = !heroVideo.muted;
        if (!heroVideo.muted) {
          heroVideo.volume = 1;
          if (heroVideo.paused) heroVideo.play().catch(function () {});
        }
        syncHeroSound();
      });
      heroVideo.addEventListener('volumechange', syncHeroSound);
      syncHeroSound();
    }

    /* 사용자가 직접 멈춘 영상은 화면에 돌아와도 저절로 다시 켜지 않습니다 */
    var heroUserPaused = reduceMotion;

    if (heroPlay) {
      heroPlay.addEventListener('click', function () {
        heroUserPaused = !heroVideo.paused;
      });
    }

    /* 화면 밖으로 나가면 잠시 멈춰 데이터·배터리를 아낍니다 */
    if ('IntersectionObserver' in window && !reduceMotion) {
      var heroIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            if (!heroUserPaused) heroVideo.play().catch(function () {});
          } else if (!heroVideo.paused) {
            heroVideo.pause();
          }
        });
      }, { threshold: 0.12 });
      heroIO.observe(heroVideo);
    }
  }

  /* ---------- 현장 소식 탭 (블로그 · 인스타그램) ---------- */
  var contentsTabs = [doc.getElementById('tabReport'), doc.getElementById('tabInsta')];
  var contentsPanels = [doc.getElementById('panelReport'), doc.getElementById('panelInsta')];

  function selectContentsTab(index) {
    contentsTabs.forEach(function (tab, i) {
      if (!tab) return;
      var on = i === index;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
      if (contentsPanels[i]) contentsPanels[i].hidden = !on;
    });
  }

  if (contentsTabs[0] && contentsTabs[1]) {
    contentsTabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () { selectContentsTab(i); });
      tab.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        var next = (i + (e.key === 'ArrowRight' ? 1 : -1) + contentsTabs.length) % contentsTabs.length;
        selectContentsTab(next);
        contentsTabs[next].focus();
      });
    });
  }

  /* ---------- 인스타그램 카드뉴스 목록 · 모달 ---------- */
  var instaDataEl = doc.getElementById('instaData');
  var instaGrid = doc.getElementById('instaGrid');
  var instaItems = [];

  if (instaDataEl) {
    try { instaItems = JSON.parse(instaDataEl.textContent) || []; } catch (err) { instaItems = []; }
  }

  if (instaGrid && instaItems.length) {
    instaItems.forEach(function (item, i) {
      var li = doc.createElement('li');
      li.className = 'insta-card';

      var btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'insta-open';
      btn.setAttribute('aria-label', item.label + ' ' + item.title + ' 카드뉴스 5장 보기');

      var img = doc.createElement('img');
      img.src = item.images[0];
      img.alt = item.label + ' ' + item.title + ' 카드뉴스 표지';
      img.width = 720;
      img.height = 720;
      img.loading = 'lazy';
      img.decoding = 'async';

      var count = doc.createElement('span');
      count.className = 'insta-count';
      count.textContent = item.images.length + '장';

      var date = doc.createElement('span');
      date.className = 'insta-datepill';
      date.textContent = item.label;

      var hint = doc.createElement('span');
      hint.className = 'insta-hint';
      hint.textContent = '전체 보기 →';

      btn.appendChild(img);
      btn.appendChild(count);
      btn.appendChild(date);
      btn.appendChild(hint);
      btn.addEventListener('click', function () { openInsta(i); });

      li.appendChild(btn);
      instaGrid.appendChild(li);
    });
  }

  var instaModal = doc.getElementById('instaModal');
  var instaImage = doc.getElementById('instaImage');
  var instaDate = doc.getElementById('instaDate');
  var instaTag = doc.getElementById('instaTag');
  var instaTitleEl = doc.getElementById('instaTitle');
  var instaBody = doc.getElementById('instaBody');
  var instaOrigin = doc.getElementById('instaOrigin');
  var instaCounter = doc.getElementById('instaCounter');
  var instaPrev = doc.getElementById('instaPrev');
  var instaNext = doc.getElementById('instaNext');
  var instaClose = doc.getElementById('instaClose');
  var instaIndex = 0;
  var instaSlide = 0;
  var instaFocus = null;

  function renderInsta() {
    var item = instaItems[instaIndex];
    if (!item || !instaModal) return;
    var total = item.images.length;
    instaImage.src = item.images[instaSlide];
    instaImage.alt = item.label + ' ' + item.title + ' 카드뉴스 ' + (instaSlide + 1) + '번째 장';
    instaCounter.textContent = (instaSlide + 1) + ' / ' + total;
    instaDate.textContent = item.label;
    instaTag.textContent = item.tag;
    instaTitleEl.textContent = item.title;
    instaBody.textContent = '';
    item.body.forEach(function (line) {
      var p = doc.createElement('p');
      p.textContent = line;
      instaBody.appendChild(p);
    });
    instaOrigin.href = item.url;
    instaPrev.disabled = false;
    instaNext.disabled = false;
  }

  function openInsta(i) {
    if (!instaModal || !instaItems[i]) return;
    instaIndex = i;
    instaSlide = 0;
    instaFocus = doc.activeElement;
    renderInsta();
    instaModal.hidden = false;
    doc.body.style.overflow = 'hidden';
    instaClose.focus();
  }

  function closeInsta() {
    if (!instaModal) return;
    instaModal.hidden = true;
    doc.body.style.overflow = '';
    if (instaFocus && instaFocus.focus) instaFocus.focus();
  }

  function stepInsta(delta) {
    var item = instaItems[instaIndex];
    if (!item) return;
    var total = item.images.length;
    instaSlide = (instaSlide + delta + total) % total;
    renderInsta();
  }

  if (instaModal) {
    instaClose.addEventListener('click', closeInsta);
    instaPrev.addEventListener('click', function () { stepInsta(-1); });
    instaNext.addEventListener('click', function () { stepInsta(1); });

    instaModal.addEventListener('click', function (e) {
      if (e.target === instaModal) closeInsta();
    });

    doc.addEventListener('keydown', function (e) {
      if (instaModal.hidden) return;
      if (e.key === 'Escape') { closeInsta(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stepInsta(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); stepInsta(1); }
      else if (e.key === 'Tab') {
        var focusables = [instaClose, instaPrev, instaNext, instaOrigin];
        var idx = focusables.indexOf(doc.activeElement);
        e.preventDefault();
        var next = (idx + (e.shiftKey ? -1 : 1) + focusables.length) % focusables.length;
        focusables[next].focus();
      }
    });

    /* 모바일 스와이프 */
    var touchX = null;
    var stage = instaModal.querySelector('.insta-stage');
    if (stage) {
      stage.addEventListener('touchstart', function (e) {
        touchX = e.changedTouches[0].clientX;
      }, { passive: true });
      stage.addEventListener('touchend', function (e) {
        if (touchX === null) return;
        var dx = e.changedTouches[0].clientX - touchX;
        if (Math.abs(dx) > 44) stepInsta(dx < 0 ? 1 : -1);
        touchX = null;
      }, { passive: true });
    }
  }

  /* ---------- 현장 영상 카드 ---------- */
  var videoCards = Array.prototype.slice.call(doc.querySelectorAll('.video-card'));

  videoCards.forEach(function (card) {
    var video = card.querySelector('video');
    var playBtn = card.querySelector('.video-play');
    var frame = card.querySelector('.video-frame');
    if (!video || !playBtn || !frame) return;

    playBtn.addEventListener('click', function () {
      videoCards.forEach(function (other) {
        var v = other.querySelector('video');
        if (v && v !== video) {
          v.pause();
          var of = other.querySelector('.video-frame');
          if (of) of.classList.remove('is-playing');
        }
      });
      frame.classList.add('is-playing');
      video.controls = true;
      /* 사용자가 직접 누른 재생이므로 소리를 켜고 재생합니다 */
      video.muted = false;
      video.volume = 1;
      video.play().catch(function () {});
    });
  });

  /* ---------- 자격증 확대 보기 ---------- */
  var certModal = doc.getElementById('certModal');
  var certImage = doc.getElementById('certImage');
  var certTitle = doc.getElementById('certTitle');
  var certClose = doc.getElementById('certClose');
  var certFocus = null;

  function openCert(btn) {
    if (!certModal || !certImage) return;
    certFocus = btn;
    var src = btn.getAttribute('data-cert');
    var title = btn.getAttribute('data-cert-title') || '';
    certImage.src = src;
    certImage.alt = title + ' 자격증 원본';
    certTitle.textContent = title;
    certModal.hidden = false;
    doc.body.style.overflow = 'hidden';
    certClose.focus();
  }

  function closeCert() {
    if (!certModal) return;
    certModal.hidden = true;
    doc.body.style.overflow = '';
    if (certFocus && certFocus.focus) certFocus.focus();
  }

  Array.prototype.forEach.call(doc.querySelectorAll('.cred-view'), function (btn) {
    btn.addEventListener('click', function () { openCert(btn); });
  });

  if (certModal) {
    certClose.addEventListener('click', closeCert);
    certModal.addEventListener('click', function (e) {
      if (e.target === certModal) closeCert();
    });
    doc.addEventListener('keydown', function (e) {
      if (!certModal.hidden && e.key === 'Escape') closeCert();
    });
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
