"use client";

import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";

type Props = {
  open: boolean;
  onClose: () => void;
  slides: Array<{ src: string }>;
  index: number;
  hasMultipleImages: boolean;
  onViewIndex: (index: number) => void;
};

export default function ProductLightbox({
  open,
  onClose,
  slides,
  index,
  hasMultipleImages,
  onViewIndex,
}: Props) {
  return (
    <Lightbox
      open={open}
      close={onClose}
      slides={slides}
      plugins={[Zoom]}
      index={index}
      on={{
        view: ({ index: nextIndex }) => {
          if (typeof nextIndex !== "number") return;
          onViewIndex(nextIndex);
        },
      }}
      carousel={{
        finite: !hasMultipleImages,
        preload: hasMultipleImages ? 2 : 0,
        spacing: hasMultipleImages ? "30%" : 0,
      }}
      controller={{
        closeOnBackdropClick: false,
        disableSwipeNavigation: !hasMultipleImages,
        preventDefaultWheelX: true,
      }}
      render={{
        buttonPrev: hasMultipleImages ? undefined : () => null,
        buttonNext: hasMultipleImages ? undefined : () => null,
      }}
    />
  );
}
