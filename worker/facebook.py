"""Facebook Reels publishing through the official Graph API, posting as the page."""

import httpx

from worker.config import FB_GRAPH_VERSION

GRAPH = f"https://graph.facebook.com/{FB_GRAPH_VERSION}"
RUPLOAD = f"https://rupload.facebook.com/video-upload/{FB_GRAPH_VERSION}"


class TokenError(Exception):
    """The page token no longer works (password change, removed admin, revoked app)."""


class FacebookError(Exception):
    pass


def _check(r: httpx.Response) -> dict:
    try:
        data = r.json()
    except ValueError:
        r.raise_for_status()
        raise FacebookError(r.text[:300])
    err = data.get("error") if isinstance(data, dict) else None
    if err:
        msg = f"{err.get('message')} (code {err.get('code')})"
        if err.get("code") in (190, 102) or err.get("type") == "OAuthException" and err.get("code") == 200:
            raise TokenError(msg)
        raise FacebookError(msg)
    r.raise_for_status()
    return data


def publish_reel(page_id: str, token: str, video_url: str, description: str) -> str:
    """Returns the Facebook video id of the published Reel."""
    start = _check(httpx.post(f"{GRAPH}/{page_id}/video_reels",
                              params={"upload_phase": "start", "access_token": token}, timeout=60))
    video_id = start["video_id"]
    _check(httpx.post(f"{RUPLOAD}/{video_id}",
                      headers={"Authorization": f"OAuth {token}", "file_url": video_url}, timeout=180))
    done = _check(httpx.post(f"{GRAPH}/{page_id}/video_reels", params={
        "upload_phase": "finish", "video_id": video_id, "video_state": "PUBLISHED",
        "description": description, "access_token": token,
    }, timeout=60))
    if not done.get("success", True):
        raise FacebookError(f"Facebook did not accept the Reel: {done}")
    return video_id


def delete_video(video_id: str, token: str) -> None:
    _check(httpx.delete(f"{GRAPH}/{video_id}", params={"access_token": token}, timeout=60))


def page_info(page_id: str, token: str) -> dict:
    """Also works as a token check: raises TokenError when the token is dead."""
    return _check(httpx.get(f"{GRAPH}/{page_id}", params={
        "fields": "id,name,followers_count,fan_count,picture{url}", "access_token": token}, timeout=30))


class PermissionMissing(Exception):
    """Token works but lacks read_insights; the user must reconnect Facebook."""


PLAY_METRICS = ("blue_reels_play_count", "fb_reels_total_plays", "fb_reels_replay_count", "post_video_views")


def _num(v):
    if isinstance(v, dict):
        return sum(x for x in v.values() if isinstance(x, (int, float)))
    return v if isinstance(v, (int, float)) else None


def reel_stats(video_id: str, token: str) -> dict:
    """Numbers for one posted Reel. Metric names differ between API versions, so the raw list is kept too."""
    r = httpx.get(f"{GRAPH}/{video_id}/video_insights", params={"access_token": token}, timeout=30)
    if r.status_code == 403 or (r.status_code == 400 and "read_insights" in r.text):
        raise PermissionMissing(r.json().get("error", {}).get("message", "read_insights missing"))
    data = _check(r).get("data") or []
    raw = {m["name"]: (m.get("values") or [{}])[0].get("value") for m in data if m.get("name")}
    social = raw.get("post_video_social_actions") or {}
    social = social if isinstance(social, dict) else {}
    plays = next((_num(raw[k]) for k in PLAY_METRICS if _num(raw.get(k)) is not None), None)
    avg = _num(raw.get("post_video_avg_time_watched"))
    return {
        "plays": plays,
        "reach": _num(raw.get("post_impressions_unique")),
        "avg_watch_sec": round(avg / 1000, 1) if avg is not None else None,
        "likes": _num(raw.get("post_video_likes_by_reaction_type")),
        "comments": _num(social.get("COMMENT") or social.get("comment")),
        "shares": _num(social.get("SHARE") or social.get("share")),
        "follows": _num(raw.get("post_video_followers")),
        "raw": raw,
    }
