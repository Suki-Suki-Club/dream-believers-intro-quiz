import { Button } from '@suki-suki-club/link-like-ui/System/Button';

export interface ChoiceGridProps {
  choices: string[];
  onChoice: (choiceIndex: number) => void;
  disabled?: boolean;
  className?: string;
}

/** The six answer choices for the current question. */
export function ChoiceGrid({
  choices,
  onChoice,
  disabled = false,
  className = '',
}: ChoiceGridProps) {
  return (
    <div
      aria-label="答えの選択肢"
      className={`choice-grid ${className}`.trim()}
      role="group"
    >
      {choices.map((choice, index) => (
        <Button
          aria-label={`${index + 1} ${choice}`}
          className="choice-grid__button"
          data-choice-index={index}
          disabled={disabled}
          key={`${index}-${choice}`}
          onClick={() => onChoice(index)}
          type="button"
          variant="secondary"
        >
          <span aria-hidden="true" className="choice-grid__number">
            {index + 1}
          </span>
          <span>{choice}</span>
        </Button>
      ))}
    </div>
  );
}
