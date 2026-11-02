type WizardStepHeadingProps = {
  title: string;
  description: string;
};

export const WizardStepHeading = ({ title, description }: WizardStepHeadingProps) => (
  <header className="space-y-1">
    <h2 className="text-heading-lg font-semibold text-foreground">{title}</h2>
    <p className="text-body-md text-muted-foreground">{description}</p>
  </header>
);
