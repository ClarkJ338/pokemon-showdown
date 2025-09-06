const API_KEY = Config.weatherKey;

export const commands: Chat.ChatCommands = {
  async weather(target: string, room: ChatRoom | null, user: User) {
    if (!target) return this.errorReply('Please specify a location. Usage: /weather [place]');
    const place = target.trim();
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(place)}&appid=${API_KEY}&units=metric`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        return this.errorReply(`Could not find weather data for "${place}".`);
      }

      const data = await res.json();
      const desc = data.weather?.[0]?.description || 'No description';
      const temp = data.main?.temp;
      const feelsLike = data.main?.feels_like;
      const humidity = data.main?.humidity;
      const windSpeed = data.wind?.speed;

      const reply = `<strong>Weather in ${place}:</strong><br>` +
        `Description: ${desc}<br>` +
        `Temperature: ${temp}°C (feels like ${feelsLike}°C)<br>` +
        `Humidity: ${humidity}%<br>` +
        `Wind Speed: ${windSpeed} m/s`;

      return this.sendReplyBox(reply);
    } catch (err) {
      console.error('Weather command error:', err);
      return this.errorReply('Error fetching weather data. Please try again later.');
    }
  },

  weatherhelp(target, room, user) {
    if (!this.runBroadcast()) return;
    this.sendReplyBox(
      `<div><b><center>Weather Command Help</center></b><br>` +
      `<ul>` +
      `<li><code>/weather [place]</code> - Shows the current weather for the given location.</li>` +
      `</ul></div>`
    );
  },
};
