function wait({
  data: { seconds },
  index,
}: {
  data: { seconds: number };
  index: number;
}) {
  seconds *= Math.random() + 0.5;
  let start = new Date();
  while ((new Date().valueOf() - start.valueOf()) / 1000 < seconds);

  return `${index} = seconds: ${seconds}`;
}

export default wait;
