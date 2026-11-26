/**
 * seal.js — 코리아 에코크린 회사 직인(대표이사 인) 이미지.
 *
 * 대표가 보낸 도장 사진(검은 배경 + 빨간 인영)에서 검은 배경을 완전히 투명하게
 * 빼 둔 PNG(`assets/company-seal.png`)를 계약서·영수증의 ‘갑’ 날인 자리에 씁니다.
 * 이미지 파일을 바꾸면 모든 서식에 함께 반영됩니다.
 */

export const COMPANY_SEAL_SRC = 'assets/company-seal.png';

/**
 * 회사 도장 <img>. className 으로 크기·위치를 정합니다(styles.css 의 .doc__seal-img 등).
 */
export function companySealImg({ className = 'doc__seal-img', alt = '코리아 에코크린 대표 직인' } = {}) {
  return `<img class="${className}" src="${COMPANY_SEAL_SRC}" alt="${alt}" decoding="async">`;
}
