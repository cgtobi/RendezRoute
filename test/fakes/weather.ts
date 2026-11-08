import type { Forecast, WeatherProvider } from "../../src/application/ports.ts";
import type { GeoPoint } from "../../src/domain/geo.ts";

/** Records what it was asked for and answers with a configurable forecast or error. */
export class FakeWeather implements WeatherProvider {
  readonly asked: { point: GeoPoint; hour: Date }[] = [];
  answer: Forecast | undefined | Error;

  constructor(answer: Forecast | undefined | Error = FakeWeather.rain) {
    this.answer = answer;
  }

  static readonly rain: Forecast = {
    weatherCode: 61,
    temperatureC: 14.2,
    precipitationProbability: 20,
    windKmh: 11.8,
  };

  forecast(point: GeoPoint, hour: Date) {
    this.asked.push({ point, hour });
    return this.answer instanceof Error
      ? Promise.reject(this.answer)
      : Promise.resolve(this.answer);
  }
}
