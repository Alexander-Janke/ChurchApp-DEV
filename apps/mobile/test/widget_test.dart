import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:church_platform_mobile/main.dart';

void main() {
  testWidgets('renders the Church Platform shell', (WidgetTester tester) async {
    await tester.pumpWidget(const ChurchPlatformApp());

    expect(find.text('Church Platform'), findsOneWidget);
    expect(find.text('IN DEVELOPMENT'), findsOneWidget);
    expect(
      find.text('You have pushed the button this many times:'),
      findsNothing,
    );
    expect(find.byType(FloatingActionButton), findsNothing);
  });
}
