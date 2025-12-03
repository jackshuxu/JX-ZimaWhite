"use client";

import { useCallback, useState } from "react";

type Props = {
  onTrigger: () => void;
  disabled?: boolean;
};

/**
 * Large trigger button for crowd mode.
 * Flashes white on press with brief cooldown feedback.
 */
export function TriggerButton({ onTrigger, disabled = false }: Props) {
  const [isFlashing, setIsFlashing] = useState(false);

  const handleClick = useCallback(() => {
    if (disabled || isFlashing) return;

    setIsFlashing(true);
    onTrigger();

    // Reset flash after animation
    setTimeout(() => {
      setIsFlashing(false);
    }, 150);
  }, [disabled, isFlashing, onTrigger]);

  return (
    <button
      onClick={handleClick}
      disabled={disabled || isFlashing}
      className={`
        relative w-full py-8 text-2xl uppercase tracking-[0.5em]
        border-2 transition-all duration-150
        ${
          isFlashing
            ? "border-white bg-white text-black scale-[0.98]"
            : "border-white/60 bg-transparent text-white hover:border-white hover:bg-white/10"
        }
        ${disabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer"}
      `}
    >
      <span className="relative z-10">TRIGGER</span>
      {isFlashing && (
        <span className="absolute inset-0 bg-white animate-ping opacity-30" />
      )}
    </button>
  );
}
