# 코리아 에코크린 공식 홈페이지

사무실·병원·상가·헬스장 정기청소 전문업체 **코리아 에코크린(Korea Eco Clean)** 의 공식 홈페이지입니다.

- 주소: <https://koreaecoclean.github.io>
- 호스팅: GitHub Pages (`main` 브랜치 루트)

## 구성

```
index.html            메인 페이지 (회사 소개·서비스·차별성·현장 사진·지역·FAQ·예약 상담)
styles.css            스타일시트 (화이트/소프트그레이 + 딥그린, 스크롤 등장 애니메이션)
script.js             인터랙션 (스크롤 진행 바·등장 애니메이션·카운트업·사진 필터/라이트박스·예약 폼)
404.html              없는 페이지 안내
robots.txt            검색 로봇 정책 + sitemap 위치
sitemap.xml           사이트맵
manifest.webmanifest  모바일 웹앱 정보
assets/
  logo.png            로고 원본 (헤더·푸터·파비콘)
  hero.jpg            첫 화면 대표 사진 (병원 클리닉 대기 라운지)
  about.jpg           회사 소개 섹션 사진 (헬스장)
  og-image.jpg        카카오톡·SNS 공유 미리보기 (1200×630)
  photos/             현장 사진 (7장)
  icon-192/512.png    앱 아이콘
```

## 수정 방법

1. 내용은 `index.html`, 디자인은 `styles.css`, 동작은 `script.js`에서 고칩니다.
2. 사진을 바꾸려면 `assets/photos/`의 파일을 같은 이름으로 교체합니다.
3. `git add -A && git commit -m "..." && git push` 하면 1~2분 뒤 사이트에 반영됩니다.
4. CSS·JS를 고친 뒤에는 `index.html`의 `?v=` 버전 값(예: `styles.css?v=20261124e`)도 함께 올려 브라우저 캐시를 갱신합니다.
5. 예약 상담 폼은 정적 페이지라 서버 저장 없이, 입력 내용을 문자(`sms:`)·전화(`tel:`)·복사로 넘기는 방식입니다.

## 사업자 정보

- 상호: 코리아 에코크린 / 대표: 채종병
- 사업자등록번호: 281-46-00169
- 주소: 서울 양천구 오목로11길 17-5 401호
- 전화: 0507-1317-8369
