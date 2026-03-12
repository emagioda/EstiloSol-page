"use client";

import { useEffect } from "react";

type BodyStyleSnapshot = {
  overflow: string;
  position: string;
  top: string;
  left: string;
  right: string;
  width: string;
  paddingRight: string;
};

let lockCount = 0;
let lockedScrollY = 0;
let previousBodyStyle: BodyStyleSnapshot | null = null;
let lastTouchY = 0;

const getScrollableAncestor = (start: HTMLElement | null): HTMLElement | null => {
  let node: HTMLElement | null = start;
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node);
    const canScrollY =
      (style.overflowY === "auto" || style.overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight;

    if (canScrollY) {
      return node;
    }

    node = node.parentElement;
  }

  return null;
};

const handleTouchStart = (event: TouchEvent) => {
  if (event.touches.length !== 1) return;
  lastTouchY = event.touches[0].clientY;
};

const handleTouchMove = (event: TouchEvent) => {
  if (!event.cancelable || event.touches.length !== 1) return;

  const target = event.target instanceof HTMLElement ? event.target : null;
  const scrollable = getScrollableAncestor(target);

  if (!scrollable) {
    event.preventDefault();
    return;
  }

  const currentY = event.touches[0].clientY;
  const deltaY = currentY - lastTouchY;
  const atTop = scrollable.scrollTop <= 0;
  const atBottom =
    scrollable.scrollTop + scrollable.clientHeight >= scrollable.scrollHeight - 1;

  if ((atTop && deltaY > 0) || (atBottom && deltaY < 0)) {
    event.preventDefault();
    return;
  }

  lastTouchY = currentY;
};

const snapshotBodyStyle = (body: HTMLElement): BodyStyleSnapshot => ({
  overflow: body.style.overflow,
  position: body.style.position,
  top: body.style.top,
  left: body.style.left,
  right: body.style.right,
  width: body.style.width,
  paddingRight: body.style.paddingRight,
});

const lockBodyScroll = () => {
  if (typeof window === "undefined") return;

  const body = document.body;
  if (lockCount === 0) {
    lockedScrollY = window.scrollY;
    previousBodyStyle = snapshotBodyStyle(body);

    const scrollbarGap = window.innerWidth - document.documentElement.clientWidth;

    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${lockedScrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";

    if (scrollbarGap > 0) {
      body.style.paddingRight = `${scrollbarGap}px`;
    }

    document.documentElement.classList.add("scroll-locked");
    body.classList.add("scroll-locked");
    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
  }

  lockCount += 1;
};

const unlockBodyScroll = () => {
  if (typeof window === "undefined") return;
  if (lockCount === 0) return;

  lockCount -= 1;
  if (lockCount > 0) return;

  const body = document.body;
  const style = previousBodyStyle;
  const scrollY = lockedScrollY;

  if (style) {
    body.style.overflow = style.overflow;
    body.style.position = style.position;
    body.style.top = style.top;
    body.style.left = style.left;
    body.style.right = style.right;
    body.style.width = style.width;
    body.style.paddingRight = style.paddingRight;
  } else {
    body.style.removeProperty("overflow");
    body.style.removeProperty("position");
    body.style.removeProperty("top");
    body.style.removeProperty("left");
    body.style.removeProperty("right");
    body.style.removeProperty("width");
    body.style.removeProperty("padding-right");
  }

  previousBodyStyle = null;
  lockedScrollY = 0;
  document.documentElement.classList.remove("scroll-locked");
  body.classList.remove("scroll-locked");
  document.removeEventListener("touchstart", handleTouchStart);
  document.removeEventListener("touchmove", handleTouchMove);
  window.scrollTo(0, scrollY);
};

export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;

    lockBodyScroll();
    return () => unlockBodyScroll();
  }, [locked]);
}
