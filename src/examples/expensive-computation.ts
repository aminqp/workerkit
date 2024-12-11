function wait({ seconds }: { seconds: number }) {
  console.log(`\n\n<<<<<  wait >>>>> => seconds -> `, seconds);
  seconds *= Math.random() + 0.5;
  let start = new Date();
  while ((new Date() - start) / 1000 < seconds);

  return `seconds: ${seconds}`;
};

export default wait;
