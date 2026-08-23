// An error, said the same way everywhere.
//
// There were twelve shapes for this one <p>, differing by margin utility and
// by which token they reached for -- thirteen sites used --accent and six used
// --danger for the same thing, though DESIGN-SYSTEM.md §2 is explicit that
// --danger is the one for things going wrong and --accent is a fill. Four of
// them wrote it as an inline style where a utility already existed.
//
// role="alert" was on two of nineteen, so a screen reader silently missed the
// other seventeen -- including every failed Request. It is not optional here.
export default function FormError({ children, className = "" }) {
  if (!children) return null;
  return (
    <p className={`form-error ${className}`.trim()} role="alert">
      {children}
    </p>
  );
}
