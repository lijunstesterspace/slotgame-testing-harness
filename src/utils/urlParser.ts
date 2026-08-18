export interface ParsedGameUrlParams {
  username?: string;
  moduleId?: string;
  gameId?: string;
  brand?: string;
  currency?: string;
}

export const parseGameUrlParams = (urlStr: string): ParsedGameUrlParams => {
  if (!urlStr) return {};

  try {
    const url = new URL(urlStr);
    const params = new URLSearchParams(url.search);

    const username = params.get('username') || params.get('loginName') || params.get('userName') || undefined;
    const moduleId = params.get('moduleId') || params.get('moduleID') || undefined;
    const gameId = params.get('gameId') || undefined;
    const brand = params.get('brand') || undefined;

    return {
      username,
      moduleId,
      gameId,
      brand
    };
  } catch (e) {
    // If string is not a full URL, try regex fallback
    const usernameMatch = urlStr.match(/[?&]user(?:name)?=([^&]+)/i);
    const moduleMatch = urlStr.match(/[?&]module[iI][dD]=([^&]+)/i);

    return {
      username: usernameMatch ? decodeURIComponent(usernameMatch[1]) : undefined,
      moduleId: moduleMatch ? decodeURIComponent(moduleMatch[1]) : undefined
    };
  }
};
