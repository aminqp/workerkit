export default () => {
  const initiator = () => {
    console.log('Initiator: ');
  };

  initiator();

  self.addEventListener('message', (event) => {
    self.postMessage(event.data);
  });
};
