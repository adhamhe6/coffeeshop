from rest_framework import serializers

from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    order_number = serializers.CharField(source="order.number", read_only=True, default=None, allow_null=True)

    class Meta:
        model = Notification
        fields = ["id", "kind", "title", "body", "is_read", "order_number", "created_at"]
        read_only_fields = fields
