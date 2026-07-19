export interface ChoiceGridProps {
  choices: string[];
  onChoice: (choiceIndex: number) => void;
  disabled?: boolean;
  wrongFlash?: boolean;
}

/** The six answer choices for the current question. */
export function ChoiceGrid({
  choices,
  onChoice,
  disabled = false,
  wrongFlash = false,
}: ChoiceGridProps) {
  return (
    <ol
      aria-label="答えの選択肢"
      className={`choices ${wrongFlash ? 'is-wrong' : ''}`.trim()}
    >
      {choices.map((choice, index) => (
        <li key={`${index}-${choice}`}>
          <button
            aria-label={`${index + 1} ${choice}`}
            className="choice"
            data-choice-index={index}
            disabled={disabled}
            onClick={() => onChoice(index)}
            type="button"
          >
            <span aria-hidden="true" className="choice__index">
              {index + 1}
            </span>
            <span>{choice}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
